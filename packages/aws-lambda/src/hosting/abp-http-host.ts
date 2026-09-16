import { AbpApplication, AbpException, forkAmbientScope, type IAbpApplication } from "@abp/core";
import { AbpHttpContext, IHttpContextAccessor, type AbpHttpRequest, type AbpHttpRequestInit, type AbpHttpResponse } from "../http-context.js";
import { AbpRequestPipeline, type RequestDelegate } from "../middleware/pipeline.js";
import { notFoundTerminal } from "../mvc/mvc-middleware.js";

export interface AbpHttpHostOptions {
  /** Customises the module-configured pipeline (add/replace middleware) before it is built. */
  configurePipeline?: (pipeline: AbpRequestPipeline) => void;
}

/**
 * Runs the ABP request pipeline against an initialized application: one DI scope per request, the context made
 * ambient through `IHttpContextAccessor`. Shared by the API Gateway handler, the local server and tests.
 */
export class AbpHttpHost {
  private readonly pipeline: RequestDelegate;

  constructor(
    readonly application: IAbpApplication,
    options: AbpHttpHostOptions = {},
  ) {
    const pipeline = AbpRequestPipeline.fromOptions(application.serviceProvider).run(notFoundTerminal);
    options.configurePipeline?.(pipeline);
    this.pipeline = pipeline.build();
  }

  /** Creates the application (if a factory returned an uninitialized one, initializes it) and the host. */
  static async create(appOrFactory: IAbpApplication | (() => Promise<IAbpApplication>), options: AbpHttpHostOptions = {}): Promise<AbpHttpHost> {
    const application = typeof appOrFactory === "function" ? await appOrFactory() : appOrFactory;
    if (application instanceof AbpApplication) await application.initialize();
    return new AbpHttpHost(application, options);
  }

  async handle(request: AbpHttpRequest | AbpHttpRequestInit, options: { abortSignal?: AbortSignal; hostEvent?: unknown } = {}): Promise<AbpHttpResponse> {
    const scope = this.application.serviceProvider.createScope();
    try {
      const context = new AbpHttpContext(request, scope.serviceProvider, options);
      const accessor = scope.serviceProvider.get(IHttpContextAccessor);
      if (!accessor) throw new AbpException("IHttpContextAccessor is not registered; add AbpAspNetCoreModule to the module graph.");
      await forkAmbientScope(() => accessor.run(context, () => this.pipeline(context)));
      return context.response;
    } finally {
      await scope.dispose();
    }
  }

  async dispose(): Promise<void> {
    await this.application.shutdown();
  }
}

/** Caches one host per container so concurrent cold-start invocations share a single application (port of the .NET host lifetime). */
export function cachedHost(appFactory: () => Promise<IAbpApplication>, options: AbpHttpHostOptions = {}): () => Promise<AbpHttpHost> {
  let pending: Promise<AbpHttpHost> | undefined;
  return () => {
    pending ??= AbpHttpHost.create(appFactory, options).catch((e: unknown) => {
      pending = undefined;
      throw e;
    });
    return pending;
  };
}
