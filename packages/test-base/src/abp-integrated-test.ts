import { AbpApplication, AbpException, ServiceCollection, type AbpApplicationCreationOptions, type IServiceProvider, type IServiceScope, type ModuleClass, type ServiceKey, type ServiceType } from "@abp/core";
import { IUnitOfWorkManager, type UnitOfWorkOptionsInput } from "@abp/uow";

/** Port of `AbpTestBaseWithServiceProvider`. */
export abstract class AbpTestBaseWithServiceProvider {
  serviceProvider!: IServiceProvider;

  getService<K extends ServiceKey>(key: K): ServiceType<K> | undefined {
    return this.serviceProvider.get(key);
  }

  getRequiredService<K extends ServiceKey>(key: K): ServiceType<K> {
    return this.serviceProvider.getRequired(key);
  }
}

/**
 * Port of `AbpIntegratedTest<TStartupModule>` / `AbpAsyncIntegratedTest<TStartupModule>` for vitest: create it in
 * `beforeAll` with `initialize()` and tear it down in `afterAll` with `dispose()`. `serviceProvider` is a scope created
 * for the test; override `afterAddApplication` to replace services before the provider is built.
 */
export class AbpIntegratedTest<TStartupModule extends ModuleClass = ModuleClass> extends AbpTestBaseWithServiceProvider {
  application!: AbpApplication;
  rootServiceProvider!: IServiceProvider;
  testServiceScope!: IServiceScope;
  private initialized = false;

  constructor(readonly startupModuleType: TStartupModule) {
    super();
  }

  async initialize(): Promise<void> {
    if (this.initialized) throw new AbpException("The integrated test has already been initialized.");
    this.initialized = true;

    const services = this.createServiceCollection();
    await this.beforeAddApplication(services);

    const options: AbpApplicationCreationOptions = { services, configuration: { skipDefaults: true } };
    this.setAbpApplicationCreationOptions(options);
    this.application = await AbpApplication.create(this.startupModuleType, options);

    await this.afterAddApplication(services);

    await this.application.initialize();
    this.rootServiceProvider = this.application.serviceProvider;
    this.testServiceScope = this.rootServiceProvider.createScope();
    this.serviceProvider = this.testServiceScope.serviceProvider;

    await this.afterInitialize();
  }

  async dispose(): Promise<void> {
    if (!this.initialized) return;
    await this.testServiceScope.dispose();
    await this.application.shutdown();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }

  protected createServiceCollection(): ServiceCollection {
    return new ServiceCollection();
  }

  protected beforeAddApplication(_services: ServiceCollection): void | Promise<void> {}

  /** Adjust the creation options (configuration values, logger factory, plug-in modules). */
  protected setAbpApplicationCreationOptions(_options: AbpApplicationCreationOptions): void {}

  /** Runs after `configureServices` and before the provider is built: the place to replace services with fakes. */
  protected afterAddApplication(_services: ServiceCollection): void | Promise<void> {}

  protected afterInitialize(): void | Promise<void> {}

  /** Port of the `WithUnitOfWorkAsync` helpers of ABP test bases: runs `fn` in a new, completed unit of work. */
  async withUnitOfWork<T>(fn: (provider: IServiceProvider) => Promise<T>, options?: UnitOfWorkOptionsInput): Promise<T> {
    return this.usingScope(async (provider) => {
      const manager = provider.getRequired(IUnitOfWorkManager);
      const uow = manager.begin(options, true);
      try {
        const result = await fn(provider);
        await uow.complete();
        return result;
      } finally {
        await uow.dispose();
      }
    });
  }

  /** Runs `fn` with a fresh service scope that is disposed afterwards. */
  async usingScope<T>(fn: (provider: IServiceProvider) => Promise<T>): Promise<T> {
    const scope = this.rootServiceProvider.createScope();
    try {
      return await fn(scope.serviceProvider);
    } finally {
      await scope.dispose();
    }
  }
}

export interface AbpIntegratedTestHooks {
  beforeAddApplication?: (services: ServiceCollection) => void | Promise<void>;
  setAbpApplicationCreationOptions?: (options: AbpApplicationCreationOptions) => void;
  afterAddApplication?: (services: ServiceCollection) => void | Promise<void>;
  afterInitialize?: (test: AbpIntegratedTest) => void | Promise<void>;
}

/** Builds an integrated test without subclassing: `const test = createAbpIntegratedTest(MyModule, { afterAddApplication })`. */
export function createAbpIntegratedTest<TStartupModule extends ModuleClass>(startupModuleType: TStartupModule, hooks: AbpIntegratedTestHooks = {}): AbpIntegratedTest<TStartupModule> {
  return new (class extends AbpIntegratedTest<TStartupModule> {
    protected override beforeAddApplication(services: ServiceCollection): void | Promise<void> {
      return hooks.beforeAddApplication?.(services);
    }
    protected override setAbpApplicationCreationOptions(options: AbpApplicationCreationOptions): void {
      hooks.setAbpApplicationCreationOptions?.(options);
    }
    protected override afterAddApplication(services: ServiceCollection): void | Promise<void> {
      return hooks.afterAddApplication?.(services);
    }
    protected override afterInitialize(): void | Promise<void> {
      return hooks.afterInitialize?.(this);
    }
  })(startupModuleType);
}
