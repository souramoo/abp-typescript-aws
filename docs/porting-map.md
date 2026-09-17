# Porting map

Status legend: ✅ ported · 🚧 in progress · ⏭ out of scope (UI, .NET-only hosting, ORM-specific).

## Framework (`../abp/framework/src` → `packages/`)

| Volo.Abp.*                                   | @abp/*                       | Status |
|----------------------------------------------|------------------------------|--------|
| Core                                         | core                         | ✅ |
| Guids                                        | guids                        | ✅ |
| Timing                                       | timing                       | ✅ |
| Data                                         | data                         | ✅ |
| Json(.Abstractions/.SystemTextJson)          | json                         | ✅ |
| Specifications                               | specifications               | ✅ |
| ObjectMapping (+AutoMapper/Mapperly)         | object-mapping               | ✅ |
| Localization(.Abstractions)                  | localization                 | ✅ |
| Validation(.Abstractions/FluentValidation)   | validation                   | ✅ |
| ObjectExtending                              | object-extending             | ✅ |
| Security                                     | security                     | ✅ |
| MultiTenancy(.Abstractions)                  | multi-tenancy                | ✅ |
| Uow                                          | uow                          | ✅ |
| EventBus(.Abstractions)                      | event-bus                    | ✅ |
| EventBus.RabbitMQ/Kafka/Azure/Rebus/Dapr     | event-bus-aws (SNS/SQS)      | ✅ |
| Auditing(.Contracts)                         | auditing                     | ✅ |
| Settings                                     | settings                     | ✅ |
| Features                                     | features                     | ✅ |
| GlobalFeatures                               | global-features              | ✅ |
| Authorization(.Abstractions)                 | authorization                | ✅ |
| Caching / Caching.StackExchangeRedis         | caching / caching-dynamodb   | ✅ |
| DistributedLocking(.Abstractions/.Dapr)      | distributed-locking (DynamoDB) | ✅ |
| BlobStoring / BlobStoring.Aws                | blob-storing / blob-storing-aws | ✅ |
| BackgroundJobs(.Abstractions) / HangFire…    | background-jobs / background-jobs-aws (SQS) | ✅ |
| BackgroundWorkers / Quartz / Hangfire        | background-workers (EventBridge) | ✅ |
| Emailing / MailKit                           | emailing / emailing-aws (SES)| ✅ |
| Sms / Sms.Aliyun / Sms.TencentCloud          | sms / sms-aws (SNS)          | ✅ |
| TextTemplating(.Core/.Scriban/.Razor)        | text-templating              | ✅ |
| Ddd.Domain(.Shared)                          | ddd-domain                   | ✅ |
| Ddd.Application(.Contracts)                  | ddd-application              | ✅ |
| EntityFrameworkCore.* / MongoDB / Dapper     | dynamodb                     | ✅ |
| MemoryDb                                     | memory-db                    | ✅ |
| Http(.Abstractions) / Http.Client            | http / http-client           | ✅ |
| AspNetCore / AspNetCore.Mvc(.Contracts)      | aws-lambda (+ http)          | ✅ |
| AspNetCore.Authentication.JwtBearer          | auth-jwt                     | ✅ |
| AspNetCore.MultiTenancy                      | aws-lambda (tenant resolvers)| ✅ |
| Swashbuckle                                  | swashbuckle                  | ✅ |
| TestBase / AspNetCore.TestBase               | test-base                    | ✅ |
| Cli / Cli.Core / Studio                      | cli (scaffolding only)       | ⏭ later |
| AspNetCore.Mvc.UI.*, Components.*, Blazor*, MudBlazor*, Bundling, Minify, Widgets, Theme.* | — | ⏭ UI |
| AspNetCore.SignalR                           | (API Gateway WebSockets)     | ⏭ later |
| Imaging.*, Ldap.*, Gdpr, Dapr, Kafka, RabbitMQ, AzureServiceBus, Quartz, HangFire, TickerQ, Castle.Core, Autofac, VirtualFileSystem, Maui.Client, AI.* | — | ⏭ |

## Modules (`../abp/modules` → `modules/`)

| module               | @abp/*                | Status |
|----------------------|-----------------------|--------|
| users                | users                 | ✅ |
| identity             | identity              | ✅ |
| permission-management| permission-management | ✅ |
| setting-management   | setting-management    | ✅ |
| feature-management   | feature-management    | ✅ |
| tenant-management    | tenant-management     | ✅ |
| audit-logging        | audit-logging         | ✅ |
| background-jobs      | background-jobs-store | ✅ |
| account              | account               | ✅ |
| openiddict / identityserver | auth-jwt (framework) | ✅ |
| blob-storing-database| —                     | ⏭ (S3) |
| basic-theme, cms-kit, blogging, docs, virtual-file-explorer, client-simulation | — | ⏭ UI/content |

## Templates (`../abp/templates` → `templates/`)

| template | package               | Status |
|----------|-----------------------|--------|
| app (HttpApi.Host + DbMigrator + tutorial book store) | @abp/template-app + infra (CDK) | ✅ |
| app-nolayers, module, microservice, console, maui | — | ⏭ |
