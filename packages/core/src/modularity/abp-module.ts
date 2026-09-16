import type { ServiceCollection } from "../dependency-injection/service-collection.js";
import type { IConfiguration } from "../configuration/configuration.js";
import type { IServiceProvider } from "../dependency-injection/service-provider.js";
import type { Class } from "../dependency-injection/service-token.js";
import type { OptionsAction, OptionsClass } from "../options/options-registry.js";
import { AbpException } from "../exception-handling/exceptions.js";
import { IConfiguration as IConfigurationToken } from "../configuration/configuration.js";

/** Port of `ServiceConfigurationContext`. */
export class ServiceConfigurationContext {
  readonly items = new Map<string, unknown>();
  private configurationCache: IConfiguration | undefined;
  constructor(readonly services: ServiceCollection) {}

  get configuration(): IConfiguration {
    if (!this.configurationCache) {
      const cfg = this.services.getSingletonInstanceOrNull(IConfigurationToken);
      if (!cfg) throw new AbpException("IConfiguration is not registered. Create the application through AbpApplicationFactory.");
      this.configurationCache = cfg;
    }
    return this.configurationCache;
  }
}

/** Port of `ApplicationInitializationContext` / `ApplicationShutdownContext`. */
export class ApplicationInitializationContext {
  readonly items = new Map<string, unknown>();
  constructor(readonly serviceProvider: IServiceProvider) {}
}
export class ApplicationShutdownContext {
  constructor(readonly serviceProvider: IServiceProvider) {}
}

export type ModuleClass = Class<AbpModule> & { dependsOn?: readonly ModuleClass[] };

const dependsOnMetadata = new WeakMap<Class, ModuleClass[]>();

/**
 * Port of `[DependsOn(typeof(...))]`. Also honoured as `static dependsOn = [...]`.
 * Order of `dependsOn` does not matter; the loader topologically sorts modules.
 */
export function DependsOn(...modules: ModuleClass[]) {
  return <C extends Class>(target: C): void => {
    const existing = dependsOnMetadata.get(target) ?? [];
    dependsOnMetadata.set(target, [...existing, ...modules]);
  };
}

export function getDependedModules(moduleType: ModuleClass): readonly ModuleClass[] {
  const fromDecorator = dependsOnMetadata.get(moduleType) ?? [];
  const fromStatic = Object.prototype.hasOwnProperty.call(moduleType, "dependsOn") ? (moduleType.dependsOn ?? []) : [];
  return [...new Set([...fromDecorator, ...fromStatic])];
}

/**
 * Port of `AbpModule`. Override the hooks you need; every hook may be async.
 *
 * ```ts
 * @DependsOn(AbpDddDomainModule)
 * export class MyModule extends AbpModule {
 *   override configureServices(context: ServiceConfigurationContext) {
 *     this.configure(MyOptions, o => { o.enabled = true; });
 *   }
 * }
 * ```
 */
export abstract class AbpModule {
  /** Skips registering `@Transient/@Scoped/@Singleton` classes (port of `SkipAutoServiceRegistration`). */
  protected skipAutoServiceRegistration = false;
  private serviceConfigurationContext: ServiceConfigurationContext | undefined;

  /** @internal */
  _setServiceConfigurationContext(context: ServiceConfigurationContext | undefined): void {
    this.serviceConfigurationContext = context;
  }
  /** @internal */
  get _skipAutoServiceRegistration(): boolean {
    return this.skipAutoServiceRegistration;
  }

  protected get context(): ServiceConfigurationContext {
    if (!this.serviceConfigurationContext) {
      throw new AbpException("ServiceConfigurationContext is only available in the configureServices, preConfigureServices and postConfigureServices methods.");
    }
    return this.serviceConfigurationContext;
  }

  preConfigureServices(_context: ServiceConfigurationContext): void | Promise<void> {}
  configureServices(_context: ServiceConfigurationContext): void | Promise<void> {}
  postConfigureServices(_context: ServiceConfigurationContext): void | Promise<void> {}

  onPreApplicationInitialization(_context: ApplicationInitializationContext): void | Promise<void> {}
  onApplicationInitialization(_context: ApplicationInitializationContext): void | Promise<void> {}
  onPostApplicationInitialization(_context: ApplicationInitializationContext): void | Promise<void> {}
  onApplicationShutdown(_context: ApplicationShutdownContext): void | Promise<void> {}

  /** `Configure<TOptions>(...)`. */
  protected configure<T extends object>(optionsClass: OptionsClass<T>, action: OptionsAction<T>): void {
    this.context.services.options.configure(optionsClass, action);
  }
  /** `PreConfigure<TOptions>(...)`. */
  protected preConfigure<T extends object>(optionsClass: OptionsClass<T>, action: OptionsAction<T>): void {
    this.context.services.options.preConfigure(optionsClass, action);
  }
  /** `PostConfigure<TOptions>(...)`. */
  protected postConfigure<T extends object>(optionsClass: OptionsClass<T>, action: OptionsAction<T>): void {
    this.context.services.options.postConfigure(optionsClass, action);
  }
  /** `Configure<TOptions>(configuration.GetSection("X"))` – shallow binding from configuration. */
  protected configureFromSection<T extends object>(optionsClass: OptionsClass<T>, sectionKey: string): void {
    const section = this.context.configuration.getSection(sectionKey);
    this.configure(optionsClass, (o) => {
      if (!section.exists()) return;
      Object.assign(o, section.toObject());
    });
  }
}

export function isAbpModule(type: unknown): type is ModuleClass {
  return typeof type === "function" && type.prototype instanceof AbpModule;
}
