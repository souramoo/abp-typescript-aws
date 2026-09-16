import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AbpModule, DependsOn, ServiceLifetime, Transient, createToken, type ServiceCollection } from "@abp/core";
import { AbpUnitOfWorkModule, IUnitOfWorkManager } from "@abp/uow";
import { AbpIntegratedTest, AbpTestBaseModule, ITestCounter, createAbpIntegratedTest } from "../src/index.js";

interface IGreeter {
  greet(): string;
}
const IGreeter = createToken<IGreeter>("IGreeter");

@Transient(IGreeter)
class Greeter implements IGreeter {
  greet(): string {
    return "hello";
  }
}

class FakeGreeter implements IGreeter {
  greet(): string {
    return "fake";
  }
}

@DependsOn(AbpTestBaseModule, AbpUnitOfWorkModule)
class TestModule extends AbpModule {
  static configured = 0;
  override configureServices(): void {
    TestModule.configured++;
  }
}

class GreeterTest extends AbpIntegratedTest<typeof TestModule> {
  afterInitializeCalled = false;
  constructor() {
    super(TestModule);
  }
  protected override afterAddApplication(services: ServiceCollection): void {
    services.replace(IGreeter, FakeGreeter, ServiceLifetime.Transient);
  }
  protected override afterInitialize(): void {
    this.afterInitializeCalled = true;
  }
}

describe("AbpIntegratedTest", () => {
  const test = new GreeterTest();
  beforeAll(() => test.initialize());
  afterAll(() => test.dispose());

  it("initializes the application and resolves services from a test scope", () => {
    expect(TestModule.configured).toBeGreaterThan(0);
    expect(test.afterInitializeCalled).toBe(true);
    expect(test.serviceProvider).not.toBe(test.rootServiceProvider);
    expect(test.getRequiredService(ITestCounter).increment("x")).toBe(1);
    expect(test.getService(createToken("Missing"))).toBeUndefined();
    expect(() => test.getRequiredService(createToken("Missing"))).toThrow(/No service/);
    expect(test.application.modules.map((m) => m.type)).toContain(AbpTestBaseModule);
  });

  it("lets afterAddApplication replace services before the provider is built", () => {
    expect(test.getRequiredService(IGreeter).greet()).toBe("fake");
  });

  it("runs work in a unit of work and in a fresh scope", async () => {
    const seen = await test.withUnitOfWork(async (provider) => provider.getRequired(IUnitOfWorkManager).current?.id);
    expect(seen).toBeDefined();
    expect(test.getRequiredService(IUnitOfWorkManager).current).toBeUndefined();
    const result = await test.usingScope(async (provider) => provider.getRequired(IGreeter).greet());
    expect(result).toBe("fake");
    await expect(test.initialize()).rejects.toThrow(/already been initialized/);
  });
});

describe("createAbpIntegratedTest", () => {
  it("wires hooks without a subclass", async () => {
    const hooked = createAbpIntegratedTest(TestModule, {
      afterAddApplication: (services) => {
        services.replace(IGreeter, FakeGreeter, ServiceLifetime.Singleton);
      },
      setAbpApplicationCreationOptions: (options) => {
        options.applicationName = "hooked";
      },
    });
    await hooked.initialize();
    try {
      expect(hooked.getRequiredService(IGreeter)).toBeInstanceOf(FakeGreeter);
      expect(hooked.getRequiredService(Greeter).greet()).toBe("hello");
      expect(hooked.application.applicationName).toBe("hooked");
    } finally {
      await hooked.dispose();
    }
  });
});
