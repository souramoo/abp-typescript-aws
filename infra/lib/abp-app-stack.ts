import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { AttributeType, BillingMode, ProjectionType, Table } from "aws-cdk-lib/aws-dynamodb";
import { HttpApi, CorsHttpMethod, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Architecture, Runtime, Tracing } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Topic } from "aws-cdk-lib/aws-sns";
import { SqsSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { Bucket, BlockPublicAccess } from "aws-cdk-lib/aws-s3";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import { join } from "node:path";

export interface AbpAppStackProps extends StackProps {
  stage: string;
  /** Directory of the application package (contains src/handlers/*.ts). */
  appDir: string;
}

/**
 * Serverless topology for an ABP application:
 *  API Gateway HTTP API → api Lambda (all HTTP routes)
 *  DynamoDB single table (entities, settings, permissions, audit logs, cache, locks, outbox/inbox)
 *  SQS jobs queue → jobs Lambda (IBackgroundJobManager)
 *  SNS events topic → SQS events queue → events Lambda (IDistributedEventBus)
 *  EventBridge schedule → workers Lambda (background workers)
 *  S3 bucket (IBlobContainer)
 */
export class AbpAppStack extends Stack {
  constructor(scope: Construct, id: string, props: AbpAppStackProps) {
    super(scope, id, props);
    const { stage, appDir } = props;
    const isProd = stage === "prod";

    const table = new Table(this, "Table", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: isProd },
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
    for (const n of [1, 2, 3]) {
      table.addGlobalSecondaryIndex({
        indexName: `gsi${n}`,
        partitionKey: { name: `gsi${n}pk`, type: AttributeType.STRING },
        sortKey: { name: `gsi${n}sk`, type: AttributeType.STRING },
        projectionType: ProjectionType.ALL,
      });
    }

    const blobs = new Bucket(this, "Blobs", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });

    const jobsDlq = new Queue(this, "JobsDlq", { retentionPeriod: Duration.days(14) });
    const jobsQueue = new Queue(this, "JobsQueue", {
      visibilityTimeout: Duration.minutes(6),
      deadLetterQueue: { queue: jobsDlq, maxReceiveCount: 5 },
    });

    const eventsTopic = new Topic(this, "EventsTopic");
    const eventsDlq = new Queue(this, "EventsDlq", { retentionPeriod: Duration.days(14) });
    const eventsQueue = new Queue(this, "EventsQueue", {
      visibilityTimeout: Duration.minutes(6),
      deadLetterQueue: { queue: eventsDlq, maxReceiveCount: 5 },
    });
    eventsTopic.addSubscription(new SqsSubscription(eventsQueue, { rawMessageDelivery: true }));

    const jwtSecret = new Secret(this, "JwtSigningKey", {
      description: "HMAC signing key for @abp/auth-jwt (rotate to invalidate all tokens)",
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
    });

    const environment: Record<string, string> = {
      ABP_ENVIRONMENT: isProd ? "Production" : "Development",
      ABP_LOG_FORMAT: "json",
      ABP__ConnectionStrings__Default: table.tableName,
      ABP__BlobStoring__Aws__BucketName: blobs.bucketName,
      ABP__BackgroundJobs__Aws__QueueUrl: jobsQueue.queueUrl,
      ABP__EventBus__Aws__TopicArn: eventsTopic.topicArn,
      ABP__EventBus__Aws__QueueUrl: eventsQueue.queueUrl,
      ABP__Auth__Jwt__SigningKeySecretArn: jwtSecret.secretArn,
      NODE_OPTIONS: "--enable-source-maps",
    };

    const fn = (name: string, entryFile: string, extra?: { timeout?: Duration; memory?: number }) =>
      new NodejsFunction(this, name, {
        entry: join(appDir, "src", "handlers", entryFile),
        handler: "handler",
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: extra?.memory ?? 1024,
        timeout: extra?.timeout ?? Duration.seconds(29),
        environment,
        tracing: Tracing.ACTIVE,
        logRetention: isProd ? RetentionDays.SIX_MONTHS : RetentionDays.TWO_WEEKS,
        bundling: {
          format: OutputFormat.ESM,
          target: "node22",
          sourceMap: true,
          minify: isProd,
          mainFields: ["module", "main"],
          banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
          externalModules: ["@aws-sdk/*"],
        },
      });

    const api = fn("ApiFunction", "api.ts");
    const jobs = fn("JobsFunction", "jobs.ts", { timeout: Duration.minutes(5) });
    const events = fn("EventsFunction", "events.ts", { timeout: Duration.minutes(5) });
    const workers = fn("WorkersFunction", "workers.ts", { timeout: Duration.minutes(5) });

    for (const f of [api, jobs, events, workers]) {
      table.grantReadWriteData(f);
      blobs.grantReadWrite(f);
      jobsQueue.grantSendMessages(f);
      eventsTopic.grantPublish(f);
      jwtSecret.grantRead(f);
    }
    jobs.addEventSource(new SqsEventSource(jobsQueue, { batchSize: 10, reportBatchItemFailures: true }));
    events.addEventSource(new SqsEventSource(eventsQueue, { batchSize: 10, reportBatchItemFailures: true }));
    new Rule(this, "WorkersSchedule", { schedule: Schedule.rate(Duration.minutes(1)), targets: [new LambdaFunction(workers)] });

    const httpApi = new HttpApi(this, "HttpApi", {
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [CorsHttpMethod.ANY],
        allowHeaders: ["*"],
      },
    });
    httpApi.addRoutes({ path: "/{proxy+}", methods: [HttpMethod.ANY], integration: new HttpLambdaIntegration("ApiIntegration", api) });
    httpApi.addRoutes({ path: "/", methods: [HttpMethod.ANY], integration: new HttpLambdaIntegration("RootIntegration", api) });

    new CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "BlobBucket", { value: blobs.bucketName });
  }
}
