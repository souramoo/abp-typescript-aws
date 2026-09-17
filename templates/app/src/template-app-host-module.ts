import { AbpModule, DependsOn, ServiceLifetime, type ServiceConfigurationContext } from "@abp/core";
import { AbpAuditLoggingDynamoDbModule } from "@abp/audit-logging/dynamodb";
import { ISigningKeyProvider } from "@abp/auth-jwt";
import { AbpBackgroundJobsAwsModule } from "@abp/background-jobs-aws";
import { AbpBackgroundJobsDynamoDbModule } from "@abp/background-jobs-store/dynamodb";
import { AbpBackgroundWorkerOptions } from "@abp/background-workers";
import { AbpBlobStoringAwsModule } from "@abp/blob-storing-aws";
import { AbpCachingDynamoDbModule } from "@abp/caching-dynamodb";
import { AbpDistributedLockingDynamoDbModule } from "@abp/distributed-locking-dynamodb";
import { addDynamoDbContext } from "@abp/dynamodb";
import { AbpEmailingAwsModule } from "@abp/emailing-aws";
import { AbpEventBusAwsModule } from "@abp/event-bus-aws";
import { AbpFeatureManagementDynamoDbModule } from "@abp/feature-management/dynamodb";
import { AbpIdentityDynamoDbModule } from "@abp/identity/dynamodb";
import { AbpPermissionManagementDynamoDbModule } from "@abp/permission-management/dynamodb";
import { AbpSettingManagementDynamoDbModule } from "@abp/setting-management/dynamodb";
import { AbpSmsAwsModule } from "@abp/sms-aws";
import { AbpTenantManagementDynamoDbModule } from "@abp/tenant-management/dynamodb";
import { SecretsManagerSigningKeyProvider } from "./auth/secrets-manager-signing-key-provider.js";
import { TemplateAppDynamoDbContext } from "./books/index.js";
import { TemplateAppModule } from "./template-app-module.js";

/**
 * Port of `MyProjectNameEntityFrameworkCoreModule` for AWS: every module's DynamoDB layer plus the AWS providers
 * (DynamoDB cache and locks, S3 blobs, SQS jobs, SNS/SQS events with the DynamoDB outbox/inbox, SES, SNS SMS).
 */
@DependsOn(
  TemplateAppModule,
  AbpIdentityDynamoDbModule,
  AbpPermissionManagementDynamoDbModule,
  AbpSettingManagementDynamoDbModule,
  AbpFeatureManagementDynamoDbModule,
  AbpTenantManagementDynamoDbModule,
  AbpAuditLoggingDynamoDbModule,
  AbpBackgroundJobsDynamoDbModule,
  AbpCachingDynamoDbModule,
  AbpDistributedLockingDynamoDbModule,
  AbpBlobStoringAwsModule,
  AbpBackgroundJobsAwsModule,
  AbpEventBusAwsModule,
  AbpEmailingAwsModule,
  AbpSmsAwsModule,
)
export class TemplateAppDynamoDbModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    addDynamoDbContext(context.services, TemplateAppDynamoDbContext, (options) => {
      options.addDefaultRepositories().addOutbox().addInbox();
    });
  }
}

/**
 * Port of `MyProjectNameHttpApiHostModule` as deployed to Lambda (`App:Database` = `DynamoDb`): AWS providers,
 * the Secrets Manager signing key and no worker timers (the workers Lambda calls `runAllOnce()` on a schedule).
 */
@DependsOn(TemplateAppDynamoDbModule)
export class TemplateAppHostModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    context.services.replace(ISigningKeyProvider, SecretsManagerSigningKeyProvider, ServiceLifetime.Singleton);
    this.configure(AbpBackgroundWorkerOptions, (options) => {
      options.startWorkersOnInitialization = false;
    });
  }
}
