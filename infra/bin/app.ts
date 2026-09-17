import { App } from "aws-cdk-lib";
import { AbpAppStack } from "../lib/abp-app-stack.js";

const app = new App();
const stage = app.node.tryGetContext("stage") ?? process.env["ABP_STAGE"] ?? "dev";
const deploymentContext: unknown = app.node.tryGetContext("deployment") ?? process.env["ABP_DEPLOYMENT"];
const deployment = deploymentContext === "split" ? "split" : "mono";

new AbpAppStack(app, `NewAbp-${stage}`, {
  stage,
  deployment,
  appDir: new URL("../../templates/app", import.meta.url).pathname,
  env: {
    account: process.env["CDK_DEFAULT_ACCOUNT"],
    region: process.env["CDK_DEFAULT_REGION"] ?? "eu-west-2",
  },
});
