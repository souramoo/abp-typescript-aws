# Decision log

| # | Decision | Why |
|---|----------|-----|
| 1 | Legacy TypeScript decorators (`experimentalDecorators`) | TC39 decorators are not transformed by vitest/oxc or esbuild yet; legacy decorators work in tsc, esbuild and oxc. |
| 2 | Tokens (`createToken<T>()`) + `static inject` instead of reflect-metadata | No runtime types in TS; explicit tokens keep DI type-safe without a metadata polyfill. |
| 3 | One package per framework package, one package with subpath exports per module | Keeps ABP's layering visible (`@abp/identity/domain` cannot import `/application`) while keeping package count sane. |
| 4 | DynamoDB single table as the default persistence | Serverless-native, no connection pools in Lambda; ABP's repository contracts are expressed without IQueryable. |
| 5 | Own JWT token endpoint (`@abp/auth-jwt`) instead of porting OpenIddict | ABP Identity remains the user store; a password + refresh_token grant is enough for API clients; Cognito JWTs are also accepted. |
| 6 | Source-exports (`"exports": "./src/index.ts"`) and esbuild bundling | No build step per package for dev/test; Lambda bundles are produced by esbuild from sources. |
