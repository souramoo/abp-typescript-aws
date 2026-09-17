/**
 * Library surface of the template. Importing this barrel loads the AWS providers (their classes register themselves
 * in DI on import), so a memory host imports `./template-app-local-module.js` directly; the Lambda entry points are
 * `./handlers/{api,jobs,events,workers}.js`.
 */
export * from "./books/index.js";
export * from "./seeding/template-app-tenants-data-seed-contributor.js";
export * from "./auth/secrets-manager-signing-key-provider.js";
export * from "./template-app-module.js";
export * from "./template-app-host-module.js";
export * from "./template-app-local-module.js";
export * from "./application.js";
