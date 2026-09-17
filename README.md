# new-abp

A TypeScript + serverless AWS port of the [ABP Framework](https://abp.io): the framework packages (`packages/*`), the
application modules (`modules/*`) and a deployable application template (`templates/app`) running on Lambda, API Gateway,
DynamoDB, SQS, SNS, EventBridge, S3 and SES.

## Quick start

```
pnpm install
pnpm dev            # local API on http://127.0.0.1:3000 with the in-memory database, seeded (admin / 1q2w3E*)
```

Log in and call the sample API (the ABP tutorial's book store lives in `templates/app/src/books`):

```
TOKEN=$(curl -s -X POST http://127.0.0.1:3000/connect/token \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d 'grant_type=password&username=admin&password=1q2w3E*&client_id=TemplateApp_App&scope=offline_access' | jq -r .access_token)

curl -s http://127.0.0.1:3000/api/app/books -H "authorization: Bearer $TOKEN"
curl -s -X POST http://127.0.0.1:3000/api/app/books -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Dune","type":7,"publishDate":"1965-08-01","price":12.5}'
curl -s http://127.0.0.1:3000/api/abp/application-configuration -H "authorization: Bearer $TOKEN"
curl -s http://127.0.0.1:3000/api/identity/users -H "authorization: Bearer $TOKEN"

# the tenant "acme" from appsettings.Development.json (its own admin, its own books)
curl -s -X POST http://127.0.0.1:3000/connect/token -H '__tenant: acme' \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d 'grant_type=password&username=admin&password=1q2w3E*&client_id=TemplateApp_App'
```

Everything ABP exposes is there: `/connect/token` (password, refresh_token, client_credentials), `/api/abp/application-configuration`,
`/api/identity/*`, `/api/account/*`, `/api/permission-management/*`, `/api/setting-management/*`, `/api/feature-management/*`,
`/api/multi-tenancy/*`, plus the sample `/api/app/books`.

## Swagger / OpenAPI

`@abp/swashbuckle` (port of `Volo.Abp.Swashbuckle`) serves the Swagger UI at `/swagger` and the OpenAPI 3.0 document at
`/swagger/v1/swagger.json`, generated from the controller decorators (`@Controller`, `@HttpGet(...)`, `route()`/`query()`/`body()`
bindings, the DTOs' zod schemas and `@Produces(Dto)` for response types). The UI assets come from the swagger-ui-dist CDN
(no static files on Lambda). Click **Authorize**, keep the pre-filled client `TemplateApp_App`, and sign in with
`admin` / `1q2w3E*` through the `oauth2` password flow against `/connect/token` (or paste a token into the `bearer` scheme);
the `__tenant` box above the UI sends the tenant header with every request.

## Commands

```
pnpm typecheck      # tsc over the whole repo
pnpm test           # vitest: packages, modules and the template (in-process, no AWS)
pnpm lint
pnpm check          # all three
pnpm dev            # templates/app on node:http with in-memory providers (PORT, ABP_DEV_DB=dynamodb-local)
pnpm seed           # templates/app: run the data seeders against the configured database (replaces the .NET DbMigrator)
pnpm synth          # infra: cdk synth (bundles the Lambda handler(s) with esbuild, no credentials needed)
pnpm deploy         # infra: cdk deploy (mono-lambda by default; `-c deployment=split` for separate functions)
pnpm --filter @abp/<name> test
```

## Environment variables

Any configuration key can be set as `ABP__<Section>__<Key>` (`__` is the section separator, as in .NET); values override
`appsettings.json` / `appsettings.<ABP_ENVIRONMENT>.json`. The ones that matter, all set by the CDK stack on Lambda:

| Variable | Meaning |
|----------|---------|
| `ABP_ENVIRONMENT` | `Development` (default of `pnpm dev`), `Staging`, `Production`: picks `appsettings.<env>.json` |
| `ABP__App__Database` | `DynamoDb` (default) or `Memory`: which startup module the handlers create |
| `ABP__ConnectionStrings__Default` | DynamoDB table name (CDK output `TableName`) |
| `ABP__Auth__Jwt__SigningKey` / `ABP__Auth__Jwt__SigningKeySecretArn` | HMAC signing key (>= 32 bytes) or the Secrets Manager secret holding it |
| `ABP__BlobStoring__Aws__BucketName` | S3 bucket of the default blob container |
| `ABP__BackgroundJobs__Aws__QueueUrl` | SQS jobs queue |
| `ABP__EventBus__Aws__TopicArn` / `ABP__EventBus__Aws__QueueUrl` | SNS events topic and its SQS subscription |
| `ABP_LOG_FORMAT` / `ABP_LOG_LEVEL` | `pretty` or `json`; `Debug`…`Error` |
| `ABP_DEV_DB=dynamodb-local` + `AWS_ENDPOINT_URL_DYNAMODB` | `pnpm dev` against DynamoDB Local (creates the table) |

## Deployment topologies

- **Mono-lambda (default)**: one function (`templates/app/src/handlers/mono.ts`) serves every HTTP route through
  API Gateway, consumes the jobs and events SQS queues, and runs the scheduled workers. It autoscales as a single
  unit with API Gateway and SQS concurrency; set `reservedConcurrentExecutions` in `infra/bin/app.ts` to cap it.
- **Split**: `cdk deploy -c deployment=split` (or `ABP_DEPLOYMENT=split`) deploys `api`, `jobs`, `events` and
  `workers` as separate functions with their own timeouts and memory.

Both topologies run the same application code; only the entry point differs.

See `templates/app/.env.example`, [docs/deploy.md](./docs/deploy.md) for the AWS flow, [CLAUDE.md](./CLAUDE.md) for
conventions, [docs/architecture.md](./docs/architecture.md) for the AWS design and
[docs/porting-map.md](./docs/porting-map.md) for the Volo.Abp.* → @abp/* mapping and status.
