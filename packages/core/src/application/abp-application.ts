import { ServiceCollection } from "../dependency-injection/service-collection.js";
import { IRootServiceProvider, IServiceProviderToken, type IServiceProvider } from "../dependency-injection/service-provider.js";
import { createToken } from "../dependency-injection/service-token.js";
import { ConfigurationBuilder, IConfiguration, type ConfigurationBuilderOptions } from "../configuration/configuration.js";
import { ConsoleLoggerFactory, ILoggerFactory, type ILoggerFactory as LoggerFactoryType } from "../logging/logger.js";
import { AbpException } from "../exception-handling/exceptions.js";
import { ApplicationInitializationContext, ApplicationShutdownContext, ServiceConfigurationContext, type ModuleClass } from "../modularity/abp-module.js";
import { ModuleLoader, type IAbpModuleDescriptor } from "../modularity/module-descriptor.js";
import { ModuleManager } from "../modularity/module-manager.js";
import { Guid } from "../text/guid.js";
import { AmbientScopeProvider, IAmbientScopeProvider } from "../threading/ambient-scope-provider.js";
import { ICancellationTokenProvider, NullCancellationTokenProvider } from "../threading/cancellation.js";
import { AbpExceptionHandlingOptions, ExceptionNotifier, IExceptionNotifier } from "../exception-handling/exception-notifier.js";

/** Port of `AbpApplicationCreationOptions`. */
export interface AbpApplicationCreationOptions {
  applicationName?: string;
  /** `Development` | `Staging` | `Production` (defaults to `ABP_ENVIRONMENT`/`NODE_ENV`). */
  environment?: string;
  configuration?: ConfigurationBuilderOptions & { values?: Record<string, unknown>; skipDefaults?: boolean };
  loggerFactory?: LoggerFactoryType;
  /** Modules loaded in addition to the startup module graph (port of `PlugInSources`). */
  plugInModules?: readonly ModuleClass[];
  /** Use an existing collection (e.g. tests) instead of creating a fresh one. */
  services?: ServiceCollection;
  skipConfigureServices?: boolean;
}

/** Port of `IAbpHostEnvironment`. */
export interface IAbpHostEnvironment {
  readonly environmentName: string;
  isDevelopment(): boolean;
  isStaging(): boolean;
  isProduction(): boolean;
}
export const IAbpHostEnvironment = createToken<IAbpHostEnvironment>("IAbpHostEnvironment");

export class AbpHostEnvironment implements IAbpHostEnvironment {
  constructor(readonly environmentName: string) {}
  isDevelopment(): boolean {
    return this.environmentName.toLowerCase() === "development";
  }
  isStaging(): boolean {
    return this.environmentName.toLowerCase() === "staging";
  }
  isProduction(): boolean {
    return this.environmentName.toLowerCase() === "production";
  }
}

/** Port of `IApplicationInfoAccessor`. */
export interface IApplicationInfoAccessor {
  readonly applicationName: string | undefined;
  readonly instanceId: string;
}
export const IApplicationInfoAccessor = createToken<IApplicationInfoAccessor>("IApplicationInfoAccessor");

/** Port of `IAbpApplication` (with internal service provider). */
export interface IAbpApplication extends IApplicationInfoAccessor, AsyncDisposable {
  readonly startupModuleType: ModuleClass;
  readonly services: ServiceCollection;
  readonly serviceProvider: IServiceProvider;
  readonly modules: readonly IAbpModuleDescriptor[];
  configureServices(): Promise<void>;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}
export const IAbpApplication = createToken<IAbpApplication>("IAbpApplication");
export const IModuleContainer = createToken<{ readonly modules: readonly IAbpModuleDescriptor[] }>("IModuleContainer");

export class AbpApplication implements IAbpApplication {
  readonly services: ServiceCollection;
  readonly modules: readonly IAbpModuleDescriptor[];
  readonly applicationName: string | undefined;
  readonly instanceId = Guid.newGuid();
  private provider: IServiceProvider | undefined;
  private configuredServices = false;
  private initialized = false;

  private constructor(
    readonly startupModuleType: ModuleClass,
    private readonly options: AbpApplicationCreationOptions,
  ) {
    this.services = options.services ?? new ServiceCollection();
    this.applicationName = options.applicationName ?? process.env["ABP_APPLICATION_NAME"];
    const environment = options.environment ?? process.env["ABP_ENVIRONMENT"] ?? process.env["NODE_ENV"] ?? "Production";

    const configBuilder = new ConfigurationBuilder();
    if (!options.configuration?.skipDefaults) configBuilder.addDefaults({ ...options.configuration, environmentName: environment });
    if (options.configuration?.values) configBuilder.addInMemory(options.configuration.values);
    const configuration = configBuilder.build();

    this.services.addSingleton(IConfiguration, { useValue: configuration });
    this.services.addSingleton(ILoggerFactory, { useValue: options.loggerFactory ?? new ConsoleLoggerFactory() });
    this.services.addSingleton(IAbpHostEnvironment, { useValue: new AbpHostEnvironment(environment) });
    this.services.addSingleton(IAbpApplication, { useValue: this });
    this.services.addSingleton(IApplicationInfoAccessor, { useValue: this });
    this.services.addSingleton(IModuleContainer, { useValue: this });
    this.services.addSingleton(IAmbientScopeProvider, { useValue: new AmbientScopeProvider() });
    this.services.tryAddSingleton(ICancellationTokenProvider, { useValue: NullCancellationTokenProvider.instance });
    this.services.tryAddTransient(IExceptionNotifier, ExceptionNotifier);
    this.services.addObjectAccessor(IServiceProviderToken);

    this.modules = new ModuleLoader().loadModules(startupModuleType, options.plugInModules ?? []);
  }

  /** Port of `AbpApplicationFactory.CreateAsync`. */
  static async create(startupModuleType: ModuleClass, options: AbpApplicationCreationOptions = {}): Promise<AbpApplication> {
    const app = new AbpApplication(startupModuleType, options);
    if (!options.skipConfigureServices) await app.configureServices();
    return app;
  }

  get serviceProvider(): IServiceProvider {
    if (!this.provider) throw new AbpException("The application has not been initialized yet. Call initialize() first.");
    return this.provider;
  }

  async configureServices(): Promise<void> {
    if (this.configuredServices) throw new AbpException("configureServices() has already been called.");
    this.configuredServices = true;
    const context = new ServiceConfigurationContext(this.services);
    this.services.addSingleton(ServiceConfigurationContext, { useValue: context });
    for (const m of this.modules) m.instance._setServiceConfigurationContext(context);

    for (const m of this.modules) await this.runPhase(m, "preConfigureServices", () => m.instance.preConfigureServices(context));
    for (const m of this.modules) {
      if (!m.instance._skipAutoServiceRegistration) this.services.addConventionalRegistrations();
      await this.runPhase(m, "configureServices", () => m.instance.configureServices(context));
    }
    for (const m of this.modules) await this.runPhase(m, "postConfigureServices", () => m.instance.postConfigureServices(context));
    for (const m of this.modules) m.instance._setServiceConfigurationContext(undefined);
  }

  /** Builds the service provider and runs the module initialization phases. */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.provider = this.services.buildServiceProvider();
    this.services.getObjectAccessorOrNull(IServiceProviderToken)!.value = this.provider;
    const context = new ApplicationInitializationContext(this.provider);
    await new ModuleManager(this.modules, this.provider).initializeModules(context);
  }

  async shutdown(): Promise<void> {
    if (!this.provider) return;
    await new ModuleManager(this.modules, this.provider).shutdownModules(new ApplicationShutdownContext(this.provider));
    await (this.provider as { disposeScope?: () => Promise<void> }).disposeScope?.();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.shutdown();
  }

  private async runPhase(module: IAbpModuleDescriptor, phase: string, fn: () => void | Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      throw new AbpException(`An error occurred during ${phase} phase of the module ${module.type.name}: ${(e as Error)?.message ?? e}. See the inner exception for details.`, { cause: e });
    }
  }
}

export const AbpApplicationFactory = {
  create: AbpApplication.create,
};

export { AbpExceptionHandlingOptions, IRootServiceProvider };
