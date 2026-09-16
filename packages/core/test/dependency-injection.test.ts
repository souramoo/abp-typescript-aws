import { describe, expect, it } from "vitest";
import { AbpInterceptor, DependsOn, IAbpLazyServiceProvider, Scoped, ServiceCollection, ServiceLifetime, Singleton, Transient, createToken, keyedToken, type IAbpMethodInvocation, type IAbpLazyServiceProvider as LazySP, AbpApplication, AbpModule, IServiceProviderToken, type ServiceConfigurationContext, DisableInterception, type IServiceProvider } from "../src/index.js";

interface IGreeter {
  greet(name: string): string;
}
const IGreeter = createToken<IGreeter>("IGreeter");

@Transient(IGreeter)
class Greeter implements IGreeter {
  greet(name: string): string {
    return `Hello ${name}`;
  }
}

@Singleton()
class Counter {
  count = 0;
}

@Scoped()
class ScopedThing {
  static readonly inject = [Counter] as const;
  constructor(readonly counter: Counter) {}
}

class LazyConsumer {
  lazyServiceProvider!: LazySP;
  get greeter(): IGreeter {
    return this.lazyServiceProvider.lazyGetRequiredService(IGreeter);
  }
}

describe("ServiceCollection / ServiceProvider", () => {
  it("resolves conventional registrations with lifetimes", () => {
    const services = new ServiceCollection();
    services.addConventionalRegistrations();
    const provider = services.buildServiceProvider();
    expect(provider.getRequired(IGreeter).greet("abp")).toBe("Hello abp");
    expect(provider.getRequired(Greeter)).not.toBe(provider.getRequired(Greeter));
    expect(provider.getRequired(Counter)).toBe(provider.getRequired(Counter));

    const scope1 = provider.createScope();
    const scope2 = provider.createScope();
    const a = scope1.serviceProvider.getRequired(ScopedThing);
    expect(a).toBe(scope1.serviceProvider.getRequired(ScopedThing));
    expect(a).not.toBe(scope2.serviceProvider.getRequired(ScopedThing));
    expect(a.counter).toBe(provider.getRequired(Counter));
  });

  it("supports factories, values, tryAdd, replace and getAll", () => {
    const services = new ServiceCollection();
    const Token = createToken<number>("Number");
    services.addSingleton(Token, { useValue: 1 });
    services.tryAddSingleton(Token, { useValue: 2 });
    services.addSingleton(Token, { useFactory: () => 3 });
    const provider = services.buildServiceProvider();
    expect(provider.getRequired(Token)).toBe(3);
    expect(provider.getAll(Token)).toEqual([1, 3]);
  });

  it("replace removes previous registrations", () => {
    const services = new ServiceCollection();
    const Token = createToken<string>("S");
    services.addSingleton(Token, { useValue: "a" });
    services.replaceSingleton(Token, { useValue: "b" });
    expect(services.buildServiceProvider().getAll(Token)).toEqual(["b"]);
  });

  it("injects the lazy service provider by property", () => {
    const services = new ServiceCollection();
    services.addConventionalRegistrations();
    services.addTransient(LazyConsumer);
    const provider = services.buildServiceProvider();
    expect(provider.getRequired(LazyConsumer).greeter.greet("x")).toBe("Hello x");
    expect(provider.getRequired(IAbpLazyServiceProvider)).toBeDefined();
  });

  it("keyed tokens are stable per (base, key)", () => {
    const base = createToken("IRepository");
    class Book {}
    expect(keyedToken(base, Book)).toBe(keyedToken(base, Book));
    expect(keyedToken(base, Book)).not.toBe(keyedToken(base, class Author {}));
  });

  it("detects circular dependencies", () => {
    const services = new ServiceCollection();
    class A {
      static inject: unknown[] = [];
    }
    class B {
      static inject = [A];
    }
    A.inject = [B];
    services.addTransient(A);
    services.addTransient(B);
    expect(() => services.buildServiceProvider().getRequired(A)).toThrow(/Circular dependency/);
  });

  it("runs interceptors around method calls", async () => {
    const calls: string[] = [];
    class LoggingInterceptor extends AbpInterceptor {
      async intercept(invocation: IAbpMethodInvocation): Promise<void> {
        calls.push(`before:${invocation.method}`);
        await invocation.proceed();
        calls.push(`after:${invocation.method}:${String(invocation.returnValue)}`);
      }
    }
    class Service {
      async work(x: number): Promise<number> {
        return x * 2;
      }
      @DisableInterception()
      sync(): number {
        return 1;
      }
    }
    const services = new ServiceCollection();
    services.addTransient(LoggingInterceptor);
    services.onRegistered((ctx) => {
      if (ctx.implementationType === Service) ctx.interceptors.add(LoggingInterceptor);
    });
    services.addTransient(Service);
    const svc = services.buildServiceProvider().getRequired(Service);
    expect(await svc.work(21)).toBe(42);
    expect(svc.sync()).toBe(1);
    expect(calls).toEqual(["before:work", "after:work:42"]);
  });

  it("disposes scoped services on scope dispose", async () => {
    const services = new ServiceCollection();
    let disposed = false;
    class D {
      dispose() {
        disposed = true;
      }
    }
    services.addScoped(D);
    const scope = services.buildServiceProvider().createScope();
    scope.serviceProvider.getRequired(D);
    await scope.dispose();
    expect(disposed).toBe(true);
  });
});

class MyOptions {
  enabled = false;
  items: string[] = [];
}

class DepModule extends AbpModule {
  static log: string[] = [];
  override configureServices(context: ServiceConfigurationContext): void {
    DepModule.log.push("dep:configure");
    context.services.addSingleton(Counter);
    this.configure(MyOptions, (o) => o.items.push("dep"));
  }
  override onApplicationInitialization(): void {
    DepModule.log.push("dep:init");
  }
}

@DependsOn(DepModule)
class RootModule extends AbpModule {
  override preConfigureServices(): void {
    DepModule.log.push("root:pre");
    this.preConfigure(MyOptions, (o) => (o.enabled = true));
  }
  override configureServices(): void {
    DepModule.log.push("root:configure");
    const pre = this.context.services.options.executePreConfiguredActions(MyOptions);
    expect(pre.enabled).toBe(true);
    this.configure(MyOptions, (o) => o.items.push("root"));
  }
  override onApplicationInitialization(context: { serviceProvider: IServiceProvider }): void {
    DepModule.log.push("root:init");
    expect(context.serviceProvider.getRequired(IServiceProviderToken)).toBe(context.serviceProvider);
  }
}

describe("AbpApplication", () => {
  it("loads modules in dependency order and runs lifecycle", async () => {
    DepModule.log = [];
    const app = await AbpApplication.create(RootModule, { configuration: { skipDefaults: true, values: { Abp: { Test: "1" } } }, environment: "Development" });
    expect(app.modules.map((m) => m.type.name)).toEqual(["DepModule", "RootModule"]);
    await app.initialize();
    expect(DepModule.log).toEqual(["root:pre", "dep:configure", "root:configure", "dep:init", "root:init"]);
    const options = app.serviceProvider.getOptions(MyOptions);
    expect(options.enabled).toBe(true);
    expect(options.items).toEqual(["dep", "root"]);
    expect(app.serviceProvider.getOptions(MyOptions)).toBe(options);
    class Untouched {
      x = 5;
    }
    expect(app.serviceProvider.getOptions(Untouched).x).toBe(5);
    await app.shutdown();
  });

  it("registers services with lifetimes when declared via decorators", async () => {
    const app = await AbpApplication.create(RootModule, { configuration: { skipDefaults: true } });
    await app.initialize();
    expect(app.serviceProvider.getRequired(IGreeter)).toBeInstanceOf(Greeter);
    expect(app.services.getDescriptors(Greeter)[0]?.lifetime).toBe(ServiceLifetime.Transient);
  });
});

import { createClassMarker, createMethodMetadata, getMethodNames } from "../src/index.js";
describe("markers", () => {
  it("class markers are inherited and method metadata walks prototypes", () => {
    const Marker = createClassMarker("Test");
    @Marker()
    class Base {
      a(): void {}
    }
    class Child extends Base {
      b(): void {}
    }
    class Other {}
    expect(Marker.has(Child)).toBe(true);
    expect(Marker.has(Other)).toBe(false);
    const Meta = createMethodMetadata<{ on: boolean }>("Meta");
    class M {
      @Meta({ on: true })
      x(): void {}
    }
    class N extends M {}
    expect(Meta.get(N, "x")).toEqual({ on: true });
    expect(Meta.get(N, "y")).toBeUndefined();
    expect(getMethodNames(Child).sort()).toEqual(["a", "b"]);
  });
});

import { ServiceLifetime as SL } from "../src/index.js";
describe("fallback resolvers", () => {
  it("resolve keyed tokens on demand like open generics", () => {
    const services = new ServiceCollection();
    const IRepo = createToken("IRepository");
    class Book {}
    class Repo {
      constructor(readonly entity: unknown = undefined) {}
    }
    services.addFallbackResolver((key) => {
      if (key === keyedToken(IRepo, Book)) return { lifetime: SL.Singleton, implementation: { useFactory: () => new Repo(Book) } };
      return undefined;
    });
    const provider = services.buildServiceProvider();
    const repo = provider.getRequired(keyedToken<Repo>(IRepo, Book));
    expect(repo.entity).toBe(Book);
    expect(provider.getRequired(keyedToken<Repo>(IRepo, Book))).toBe(repo);
    expect(provider.get(keyedToken(IRepo, class Other {}))).toBeUndefined();
  });
});
