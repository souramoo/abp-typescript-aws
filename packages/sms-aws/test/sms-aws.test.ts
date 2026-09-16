import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, NullLoggerFactory } from "@abp/core";
import { ISmsSender, NullSmsSender, SmsMessage } from "@abp/sms";
import { AbpSmsAwsModule, AbpSnsSmsOptions, SnsSmsMessageProperties, SnsSmsSender } from "../src/index.js";

const snsMock = mockClient(SNSClient);

@DependsOn(AbpSmsAwsModule)
class TestModule extends AbpModule {}

async function createApp(values: Record<string, unknown> = {}) {
  const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true, values }, loggerFactory: NullLoggerFactory.instance });
  await app.initialize();
  return app;
}

describe("SNS sms sender", () => {
  beforeEach(() => snsMock.reset());

  it("replaces the null sender and publishes to the phone number with the SMS type", async () => {
    const app = await createApp();
    const sender = app.serviceProvider.getRequired(ISmsSender);
    expect(sender).toBeInstanceOf(SnsSmsSender);
    expect(sender).not.toBeInstanceOf(NullSmsSender);
    snsMock.on(PublishCommand).resolves({ MessageId: "1" });

    await sender.send(new SmsMessage("+15550001111", "Your code is 1234"));
    const input = snsMock.commandCalls(PublishCommand)[0]!.args[0].input;
    expect(input).toMatchObject({ PhoneNumber: "+15550001111", Message: "Your code is 1234" });
    expect(input.MessageAttributes).toEqual({ "AWS.SNS.SMS.SMSType": { DataType: "String", StringValue: "Transactional" } });
  });

  it("binds options from Sms:Aws and lets message properties override them", async () => {
    const app = await createApp({ Sms: { Aws: { Region: "eu-central-1", SmsType: "Promotional", SenderId: "ABP" } } });
    const options = app.serviceProvider.getOptions(AbpSnsSmsOptions);
    expect(options).toMatchObject({ region: "eu-central-1", smsType: "Promotional", senderId: "ABP" });
    snsMock.on(PublishCommand).resolves({});

    const sender = app.serviceProvider.getRequired(ISmsSender);
    await sender.send(new SmsMessage("+1", "promo"));
    expect(snsMock.commandCalls(PublishCommand)[0]!.args[0].input.MessageAttributes).toEqual({
      "AWS.SNS.SMS.SMSType": { DataType: "String", StringValue: "Promotional" },
      "AWS.SNS.SMS.SenderID": { DataType: "String", StringValue: "ABP" },
    });

    const message = new SmsMessage("+1", "otp");
    message.properties.set(SnsSmsMessageProperties.SmsType, "Transactional");
    message.properties.set(SnsSmsMessageProperties.SenderId, "OTP");
    await sender.send(message);
    expect(snsMock.commandCalls(PublishCommand)[1]!.args[0].input.MessageAttributes).toEqual({
      "AWS.SNS.SMS.SMSType": { DataType: "String", StringValue: "Transactional" },
      "AWS.SNS.SMS.SenderID": { DataType: "String", StringValue: "OTP" },
    });
  });
});
