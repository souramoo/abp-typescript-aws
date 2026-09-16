import { describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, LogLevel, LoggerBase, NullLoggerFactory, Singleton, type ILogger, type ILoggerFactory } from "@abp/core";
import { AbpSmsModule, ISmsSender, NullSmsSender, SmsMessage, sendSms } from "../src/index.js";

@DependsOn(AbpSmsModule)
class TestModule extends AbpModule {}

class RecordingLoggerFactory implements ILoggerFactory {
  readonly warnings: string[] = [];
  createLogger(category: string): ILogger {
    const warnings = this.warnings;
    return new (class extends LoggerBase {
      write(level: LogLevel, message: string): void {
        if (level === LogLevel.Warning) warnings.push(message);
      }
    })(category, LogLevel.Trace);
  }
}

describe("sms", () => {
  it("validates the message", () => {
    expect(() => new SmsMessage("", "hi")).toThrow("phoneNumber");
    expect(() => new SmsMessage("+1", " ")).toThrow("text");
    const message = new SmsMessage("+1555", "hi");
    message.properties.set("k", 1);
    expect(message.properties.get("k")).toBe(1);
  });

  it("registers NullSmsSender unless another sender is registered", async () => {
    const loggerFactory = new RecordingLoggerFactory();
    const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true }, loggerFactory });
    await app.initialize();
    const sender = app.serviceProvider.getRequired(ISmsSender);
    expect(sender).toBeInstanceOf(NullSmsSender);
    await sendSms(sender, "+1555", "hello");
    expect(loggerFactory.warnings[0]).toContain("NullSmsSender");
  });

  it("lets a custom sender replace the null one", async () => {
    @Singleton(ISmsSender)
    class CustomSender {
      static readonly sent: SmsMessage[] = [];
      async send(message: SmsMessage): Promise<void> {
        CustomSender.sent.push(message);
      }
    }
    const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true }, loggerFactory: NullLoggerFactory.instance });
    await app.initialize();
    await app.serviceProvider.getRequired(ISmsSender).send(new SmsMessage("+1", "x"));
    expect(CustomSender.sent).toHaveLength(1);
  });
});
