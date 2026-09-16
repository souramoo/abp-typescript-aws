# Architecture

new-abp keeps ABP's layered, modular architecture and swaps the runtime for AWS serverless primitives.

## Request flow (HTTP)

```
API Gateway (HTTP API v2) ──▶ Lambda (Node 22, esbuild bundle)
                                 │  @abp/aws-lambda adapter: event → AbpHttpContext
                                 │  middleware pipeline (port of the ASP.NET Core pipeline ABP configures):
                                 │    correlation id → exception handling → JWT authentication → current principal
                                 │    → tenant resolution (header/query/domain/claim) → auditing scope → unit of work
                                 │    → router (controllers from modules' http-api layers) → JSON response
                                 ▼
                             application services (interceptors: validation, authorization, feature check, uow, audit)
                                 ▼
                             domain services / repositories (@abp/dynamodb single table, GSIs per entity)
```

One `AbpApplication` is created per Lambda container at cold start (module graph, DI, options) and cached;
each invocation gets a DI scope, exactly like one request scope in ASP.NET Core.

## Data

DynamoDB single-table design (`@abp/dynamodb`):

- `pk = <tenantId|host>#<EntityName>#<id>`, `sk = <EntityName>` for point lookups.
- `gsi1pk = <tenantId|host>#<EntityName>`, `gsi1sk = <creationTime|id>` for list/paging per entity type.
- Entities register extra indexes (`gsi2`, `gsi3`) through the module's `DynamoDbContext` configuration
  (e.g. users by normalized user name / email; permission grants by provider).
- Unit of work batches writes and commits with `TransactWriteItems` (≤100 items); the ABP `IUnitOfWork`
  semantics (complete / rollback / on-completed handlers / local & distributed event publishing) are preserved.
- Soft delete, multi-tenancy and audit fields are handled by the repository base (port of ABP's data filters).

## Async messaging

- Local event bus: in-process, published on UoW completion.
- Distributed event bus: SNS topic → per-service SQS queue → Lambda; DynamoDB-backed outbox/inbox.
- Background jobs: SQS queue (+ delay) → Lambda job worker; job records in DynamoDB.
- Background workers: EventBridge Scheduler → Lambda.

## Auth

Users, roles, claims, permissions live in the Identity / PermissionManagement modules on DynamoDB.
Tokens: `@abp/auth-jwt` issues JWTs (password and refresh_token grants, RS256/HS256) and validates them; the same
principal accessor can validate Cognito-issued JWTs (JWKS). `ICurrentUser`, `IPermissionChecker` and the rest of the
authorization stack are ported unchanged.
