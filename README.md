# new-abp

A TypeScript + serverless AWS port of the [ABP Framework](https://abp.io).

```
pnpm install
pnpm typecheck && pnpm test
pnpm dev        # local API on http://localhost:3000 (in-memory DB)
pnpm deploy     # AWS CDK deploy of templates/app
```

See [CLAUDE.md](./CLAUDE.md) for conventions, [docs/architecture.md](./docs/architecture.md) for the AWS design and
[docs/porting-map.md](./docs/porting-map.md) for the Volo.Abp.* → @abp/* mapping and status.
