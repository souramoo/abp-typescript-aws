# Deploying the template application to AWS

`infra/` is an AWS CDK app (`infra/lib/abp-app-stack.ts`) that deploys `templates/app` as four Lambda functions behind one
API Gateway HTTP API, with a DynamoDB single table, an S3 bucket, an SQS jobs queue, an SNS events topic with an SQS
subscription, an EventBridge schedule for the background workers and a Secrets Manager secret for the JWT signing key.

```
API Gateway ──▶ api.ts       (every HTTP route: TemplateAppHostModule on DynamoDB)
SQS jobs    ──▶ jobs.ts      (IBackgroundJobManager messages → IBackgroundJob.execute)
SNS ▶ SQS   ──▶ events.ts    (distributed events → handlers, or the DynamoDB inbox)
EventBridge ──▶ workers.ts   (every minute: outbox sender, inbox processor, job worker, background workers)
```

## Prerequisites

- Node 22+, pnpm, AWS credentials for the target account (`AWS_PROFILE` or environment variables).
- One-time CDK bootstrap per account/region: `pnpm --filter @abp/infra exec cdk bootstrap aws://<account>/<region>`.

## Topology: mono-lambda (default) or split

The stack deploys a single `MonoFunction` unless told otherwise: it is the API Gateway integration for `/` and
`/{proxy+}`, the consumer of both SQS queues, and the target of the one-minute EventBridge rule. It scales with
incoming traffic like any Lambda; the only knob is `reservedConcurrentExecutions` (optional, in `infra/bin/app.ts`).

```
pnpm synth                              # mono
pnpm --filter @abp/infra cdk synth -c deployment=split   # api + jobs + events + workers functions
ABP_DEPLOYMENT=split pnpm deploy        # same via environment
```

Switching topology later is a normal `cdk deploy`; data and queues are unaffected because both use the same
application code and configuration.

## Synthesize and deploy

```
pnpm synth                                    # cdk synth, no credentials needed (set CDK_DEFAULT_ACCOUNT/REGION if asked)
pnpm deploy                                   # stage "dev" → stack NewAbp-dev
pnpm --filter @abp/infra exec cdk deploy -c stage=prod   # or ABP_STAGE=prod
```

The stage comes from the `stage` context value (`-c stage=…`) or `ABP_STAGE` (default `dev`). `prod` keeps the table and
bucket on stack deletion, enables point-in-time recovery, minifies the bundles and sets `ABP_ENVIRONMENT=Production`;
every other stage runs as `Staging`. Bundling is done by the workspace's esbuild (`forceDockerBundling: false`), the
`@aws-sdk/*` packages stay external (the Node 22 runtime ships them) and `appsettings.json`, `appsettings.Staging.json`
and `appsettings.Production.json` are copied next to the bundle, where `configurationBasePath()` finds them.

Outputs: `ApiUrl` (the HTTP API endpoint), `TableName`, `BlobBucket`.

## Configuration on Lambda

The stack sets the environment of all four functions (see `templates/app/.env.example`):

| Variable | Set to |
|----------|--------|
| `ABP__App__Database` | `DynamoDb` — the handlers create `TemplateAppHostModule` |
| `ABP__ConnectionStrings__Default` | the DynamoDB table name (also used by the cache, locks, outbox/inbox) |
| `ABP__BlobStoring__Aws__BucketName` | the S3 bucket |
| `ABP__BackgroundJobs__Aws__QueueUrl` | the jobs queue |
| `ABP__EventBus__Aws__TopicArn`, `ABP__EventBus__Aws__QueueUrl` | the events topic and queue |
| `ABP__Auth__Jwt__SigningKeySecretArn` | the Secrets Manager secret |
| `ABP_ENVIRONMENT`, `ABP_LOG_FORMAT=json` | environment name and structured CloudWatch logs |

`ABP__<Section>__<Key>` variables are loaded twice by `ConfigurationBuilder.addDefaults`: as they are and with the `ABP__`
prefix removed, so `ABP__ConnectionStrings__Default` is `ConnectionStrings:Default` and `ABP__Auth__Jwt__Issuer` is
`Abp:Auth:Jwt:Issuer`. Anything else (`App:SelfUrl`, `Settings:*`, `Abp:Auth:Jwt:Audience`, …) goes into
`appsettings.Staging.json` / `appsettings.Production.json` or the function environment (edit `infra/lib/abp-app-stack.ts`).

## Secrets: the JWT signing key

`@abp/auth-jwt` signs and validates tokens with an HMAC key (RS256 and JWKS/Cognito are configurable through
`Abp:Auth:Jwt`). The stack generates a 64-character secret in Secrets Manager and grants the functions `GetSecretValue`.
`TemplateAppHostModule` registers `SecretsManagerSigningKeyProvider`
(`templates/app/src/auth/secrets-manager-signing-key-provider.ts`), which fetches the secret once per container when
`Abp:Auth:Jwt:SigningKey` is not configured and `SigningKeySecretArn` is. Rotating the secret invalidates every token at the
next cold start. Locally the key is the `SigningKey` of `appsettings.Development.json` (never deploy that file; it is not
copied into the bundles).

## Seeding on AWS

There is no schema to migrate, so the .NET `DbMigrator` becomes `pnpm seed`: it runs every `IDataSeedContributor`
(admin user and role, all permissions for `admin`, static settings/features definitions, the tenants of the `Tenants`
section and the sample books) against the configured database.

```
export AWS_REGION=eu-west-2
export ABP__ConnectionStrings__Default=<TableName output>
export ABP__Auth__Jwt__SigningKeySecretArn=<secret ARN>      # or ABP__Auth__Jwt__SigningKey=<32+ chars>
export ABP_ENVIRONMENT=Staging                               # or Production
pnpm seed                                                    # host side
pnpm seed -- --tenant <tenant id>                            # one tenant
pnpm seed -- --ensure-table                                  # also creates the table (DynamoDB Local / ad-hoc tables)
```

Tenants created through `POST /api/multi-tenancy/tenants` are seeded automatically, as in ABP.

## Logs and diagnostics

- CloudWatch log groups `/aws/lambda/NewAbp-<stage>-ApiFunction…` etc. (retention 2 weeks, 6 months in prod), JSON lines
  with `category`, `level`, `message`, `data` (correlation id, tenant, user) from `ConsoleLoggerFactory`.
- X-Ray tracing is active on every function.
- Failed job/event messages go to the `JobsDlq` / `EventsDlq` queues after 5 attempts (`reportBatchItemFailures`).
- Audit logs (`AbpAuditLoggingModule`) and background job records live in the DynamoDB table.

## Local development against DynamoDB Local

```
docker run -p 8000:8000 amazon/dynamodb-local
ABP_DEV_DB=dynamodb-local AWS_ENDPOINT_URL_DYNAMODB=http://localhost:8000 AWS_REGION=eu-west-2 \
AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local ABP__ConnectionStrings__Default=TemplateApp pnpm dev
```

`pnpm dev` then starts `TemplateAppHostModule` (the AWS providers: a bucket/queue/topic must be configured for blobs, jobs
and events to work), creates the table with `ensureTableExists` and seeds it.
