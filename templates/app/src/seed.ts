import { parseArgs } from "node:util";
import { ILoggerFactory } from "@abp/core";
import { IDataSeeder } from "@abp/data";
import { ensureTableExists } from "@abp/dynamodb";
import { createHostApplication, resolveDatabase, buildConfiguration, environmentName } from "./application.js";

/**
 * Port of the .NET `DbMigrator` for a schemaless database: `pnpm seed [--tenant <id>] [--ensure-table]` runs every
 * `IDataSeedContributor` (admin user and role, permissions, settings, tenants and sample books) against the
 * configured database (`ABP__ConnectionStrings__Default`, or `App:Database=Memory` for a dry run).
 */
const { values } = parseArgs({
  options: {
    tenant: { type: "string" },
    "ensure-table": { type: "boolean", default: false },
  },
});

const app = await createHostApplication();
const logger = app.serviceProvider.getRequired(ILoggerFactory).createLogger("seed");
try {
  const database = resolveDatabase(buildConfiguration(environmentName()));
  if (values["ensure-table"] && database === "DynamoDb") {
    const created = await ensureTableExists(app.serviceProvider);
    logger.info(created ? "Created the DynamoDB table." : "The DynamoDB table already exists.");
  }
  logger.info(`Seeding the ${database} database${values.tenant ? ` for tenant ${values.tenant}` : ""}...`);
  await app.serviceProvider.getRequired(IDataSeeder).seed(values.tenant);
  logger.info("Seeding completed.");
} finally {
  await app.shutdown();
}
