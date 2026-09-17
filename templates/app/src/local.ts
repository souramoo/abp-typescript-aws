import { createLocalServer } from "@abp/aws-lambda";
import { IDataSeeder } from "@abp/data";
import { ensureTableExists } from "@abp/dynamodb";
import { createApplication, createLocalApplication, loadStartupModule } from "./application.js";
import { TemplateAppClientId } from "./template-app-module.js";

const port = Number(process.env["PORT"] ?? 3000);
const useDynamoDbLocal = process.env["ABP_DEV_DB"] === "dynamodb-local";

const server = createLocalServer(
  async () => {
    const app = useDynamoDbLocal ? await createApplication(await loadStartupModule("DynamoDb"), { environment: process.env["ABP_ENVIRONMENT"] ?? "Development" }) : await createLocalApplication();
    if (useDynamoDbLocal) await ensureTableExists(app.serviceProvider);
    await app.serviceProvider.getRequired(IDataSeeder).seed();
    return app;
  },
  { port },
);

const { url } = await server.start();
await server.getHost();

const database = useDynamoDbLocal ? `DynamoDB Local (${process.env["AWS_ENDPOINT_URL_DYNAMODB"] ?? "AWS_ENDPOINT_URL_DYNAMODB not set"})` : "in-memory";
process.stdout.write(
  [
    `TemplateApp is listening on ${url} (${database} database, seeded with admin / 1q2w3E*).`,
    "",
    "Get a token:",
    `  curl -s -X POST ${url}/connect/token -H 'content-type: application/x-www-form-urlencoded' \\`,
    `    -d 'grant_type=password&username=admin&password=1q2w3E*&client_id=${TemplateAppClientId}&scope=offline_access'`,
    "",
    "Then, with TOKEN=<access_token>:",
    `  curl -s ${url}/api/app/books -H "authorization: Bearer $TOKEN"`,
    `  curl -s ${url}/api/abp/application-configuration -H "authorization: Bearer $TOKEN"`,
    "",
  ].join("\n"),
);

const shutdown = async (): Promise<void> => {
  await server.stop();
  await (await server.getHost()).dispose();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
