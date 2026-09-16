import { ILoggerFactory } from "../logging/logger.js";
import { AbpInitializationException, AbpShutdownException } from "../exception-handling/exceptions.js";
import type { IServiceProvider } from "../dependency-injection/service-provider.js";
import type { ApplicationInitializationContext, ApplicationShutdownContext } from "./abp-module.js";
import type { IAbpModuleDescriptor } from "./module-descriptor.js";

/** Port of `ModuleManager` + `DefaultModuleLifecycleContributor`s. */
export class ModuleManager {
  constructor(
    private readonly modules: readonly IAbpModuleDescriptor[],
    private readonly serviceProvider: IServiceProvider,
  ) {}

  async initializeModules(context: ApplicationInitializationContext): Promise<void> {
    const logger = this.serviceProvider.get(ILoggerFactory)?.createLogger("AbpApplication");
    const phases = ["onPreApplicationInitialization", "onApplicationInitialization", "onPostApplicationInitialization"] as const;
    for (const phase of phases) {
      for (const module of this.modules) {
        try {
          await module.instance[phase](context);
        } catch (e) {
          throw new AbpInitializationException(`An error occurred during ${phase} phase of the module ${module.type.name}: ${(e as Error)?.message ?? e}`, { cause: e });
        }
      }
    }
    logger?.info("Initialized all ABP modules.", { count: this.modules.length });
  }

  async shutdownModules(context: ApplicationShutdownContext): Promise<void> {
    for (const module of [...this.modules].reverse()) {
      try {
        await module.instance.onApplicationShutdown(context);
      } catch (e) {
        throw new AbpShutdownException(`An error occurred during the shutdown of the module ${module.type.name}: ${(e as Error)?.message ?? e}`, { cause: e });
      }
    }
  }
}
