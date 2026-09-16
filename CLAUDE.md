# new-abp — TypeScript + serverless AWS port of the ABP Framework

This repository is a port of the open-source ABP Framework (`../abp`, .NET, https://abp.io) to
TypeScript running on AWS serverless services (Lambda, API Gateway, DynamoDB, SQS, SNS/EventBridge, S3, SES).
The .NET source of truth is checked out at `../abp` (framework in `../abp/framework/src`, modules in `../abp/modules`).
When porting, read the original C# first and keep ABP's public concepts, names and semantics; change only what
the runtime forces (no reflection, no LINQ, no assemblies, no Castle proxies, no EF Core).

## Working style (pstack)

pstack (https://github.com/cursor/plugins/tree/main/pstack) is installed in `.cursor/plugins/pstack`, and its skills are
mirrored into `.claude/skills` and `.agents/skills`. Apply `typescript-best-practices`, `principle-model-the-domain`,
`principle-prove-it-works`, `principle-test-behavior-not-implementation`, `principle-boundary-discipline` and
`no-comments` (no narrating comments; doc comments only where they explain a port decision). Use `/poteto-mode` for
non-trivial tasks. Prefer small, verifiable units: every package ships with vitest tests that run in-process.

## Repository layout

```
packages/<name>/        framework packages, published as @abp/<name>   (port of Volo.Abp.<Name>)
modules/<name>/         application modules, published as @abp/<name>  (port of ../abp/modules/<name>)
templates/app/          deployable sample application (port of the ABP app startup template)
infra/                  AWS CDK app that deploys templates/app
docs/                   architecture, porting map, decisions
```

Every package has: `package.json` (`"exports": {".": "./src/index.ts"}` plus subpaths, `workspace:*` deps),
`tsconfig.json` extending `../../tsconfig.base.json`, `src/index.ts` barrel, `test/*.test.ts`.
Root `pnpm typecheck` type-checks everything with one tsconfig; `pnpm test` runs all vitest suites; `pnpm lint` runs eslint.
Imports inside a package use relative paths with `.js` extension; imports across packages use `@abp/<name>`.

Application modules keep ABP's layering as subpath exports of one package, e.g. `@abp/identity/domain-shared`,
`@abp/identity/domain`, `@abp/identity/application-contracts`, `@abp/identity/application`, `@abp/identity/http-api`,
`@abp/identity/dynamodb`. Dependency direction is the same as ABP: http-api → application-contracts;
application → domain + application-contracts; domain → domain-shared; dynamodb → domain.

## Core conventions (see `packages/core`)

- **Services are identified by tokens.** Interfaces become `export const IFoo = createToken<IFoo>("IFoo")` next to
  `export interface IFoo`. Classes can be keys directly. Closed generics use `keyedToken(IRepository, Book)`.
- **Constructor injection** is declared with `static readonly inject = [IFoo, IBar] as const;` matching the constructor
  parameters positionally. Base classes that ABP property-injects (`ApplicationService`, `DomainService`, …) declare
  `lazyServiceProvider!: IAbpLazyServiceProvider` and it is set by the container after construction.
- **Conventional registration**: `@Transient(IFoo)`, `@Scoped()`, `@Singleton()` replace `ITransientDependency` +
  `[ExposeServices]`; `@Dependency({ replaceServices: true })` replaces `[Dependency(ReplaceServices = true)]`.
  These are legacy TypeScript decorators (`experimentalDecorators`). Decorated classes are registered by the
  application before each module's `configureServices` (port of assembly scanning), so a class is registered as soon as
  its file is imported by a module.
- **Modules**: `@DependsOn(OtherModule) export class MyModule extends AbpModule` with `preConfigureServices`,
  `configureServices`, `postConfigureServices`, `onApplicationInitialization`, `onApplicationShutdown` (all may be
  async). Options: `this.configure(MyOptions, o => …)`; consumers read `provider.getOptions(MyOptions)` or inject
  `optionsToken(MyOptions)` (`IOptions<T>` with `.value`). Options classes are plain classes with defaults.
- **Interceptors** (UoW, auditing, authorization, validation, feature checks): implement `AbpInterceptor`, register with
  `services.onRegistered(ctx => { if (shouldIntercept(ctx.implementationType)) ctx.interceptors.tryAdd(MyInterceptor) })`.
  Marker interfaces (`IUnitOfWorkEnabled`, `IAuditingEnabled`) become static flags or decorators on the class; document which.
  Intercepted methods must be async.
- **Ambient context** (`ICurrentTenant.change`, `ICurrentPrincipalAccessor.change`, `IDataFilter.disable`, UoW):
  `AmbientScopeProvider` over `AsyncLocalStorage`. Offer both `change(x): Disposable` (for `using`) and `run(x, fn)`.
- **Exceptions**: `AbpException`, `BusinessException({ code, message, details })`, `UserFriendlyException`, plus the
  `IHasErrorCode/IHasHttpStatusCode/IHasValidationErrors` guards in `@abp/core`.
- **Guid** is `string` (UUID). `IGuidGenerator.create()` returns UUID v7 (sequential, DynamoDB-friendly).
- **Validation** uses zod schemas attached to DTO classes (`static readonly schema = z.object(...)`).
- **No `any`**, `unknown` at boundaries, discriminated unions for variants, exhaustive `switch` with `never` checks.
- Logging via `ILoggerFactory.createLogger(category)`; never `console.log` in shipped code.
- Base classes meant to be subclassed declare `static readonly inject: readonly ServiceKey[] = [...]` (not `as const`, so
  subclasses can override with different deps). Conventional registration decorators are not inherited: every concrete
  subclass needs its own `@Transient()`/`@Scoped()`.
- Ambient scopes: `change()` uses `AsyncLocalStorage.enterWith`, which is visible to the caller after `await callee()`.
  Infrastructure that begins scopes on behalf of a caller (interceptors, seeders, resolvers) wraps the call in
  `forkAmbientScope(fn)` / `provider.fork(fn)` or uses the `run(value, fn)` form.
- Cross-cutting concern names live in `AbpCrossCuttingConcerns` (core) and are used with `AppliedCrossCuttingConcerns`.

## Serverless mapping

| ABP (.NET)                                  | new-abp                                                     |
|---------------------------------------------|-------------------------------------------------------------|
| ASP.NET Core MVC controllers / auto API     | `@abp/http` router + `@abp/aws-lambda` API Gateway adapter  |
| EF Core / MongoDB repositories              | `@abp/dynamodb` single-table repositories; `@abp/memory-db` |
| IDistributedCache (Redis)                   | `@abp/caching` in-memory + `@abp/caching-dynamodb`          |
| IDistributedEventBus (RabbitMQ/Kafka)       | `@abp/event-bus-aws` (SNS → SQS, outbox in DynamoDB)        |
| Background jobs (Hangfire/Quartz)           | `@abp/background-jobs-aws` (SQS + Lambda consumer)          |
| Background workers                          | EventBridge scheduled Lambda                                |
| BlobStoring                                 | `@abp/blob-storing-aws` (S3)                                |
| Emailing (MailKit) / SMS                    | `@abp/emailing-aws` (SES) / `@abp/sms-aws` (SNS)            |
| OpenIddict / IdentityServer                 | `@abp/auth-jwt` token endpoint (password + refresh) and Cognito JWT validation |
| Distributed locking (Redis/Dapr)            | DynamoDB conditional writes                                 |

## Commands

```
pnpm install
pnpm typecheck        # tsc over the whole repo
pnpm test             # vitest
pnpm lint
pnpm --filter @abp/<name> test
```
