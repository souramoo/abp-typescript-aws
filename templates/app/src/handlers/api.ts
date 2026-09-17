import { createApiGatewayHandler } from "@abp/aws-lambda";
import { createHostApplication } from "../application.js";

/** API Gateway HTTP API (v2) entry point: every route of the application. */
export const handler = createApiGatewayHandler(() => createHostApplication());
