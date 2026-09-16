import { App } from "aws-cdk-lib";
import { AbpAppStack } from "../lib/abp-app-stack.js";

const app = new App();
const stage = app.node.tryGetContext("stage") ?? process.env["ABP_STAGE"] ?? "dev";

new AbpAppStack(app, `NewAbp-${stage}`, {
  stage,
  appDir: new URL("../../templates/app", import.meta.url).pathname,
  env: {
    account: process.env["CDK_DEFAULT_ACCOUNT"],
    region: process.env["CDK_DEFAULT_REGION"] ?? "eu-west-2",
  },
});
