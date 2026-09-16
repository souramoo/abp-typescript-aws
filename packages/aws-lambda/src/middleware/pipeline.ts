import { AbpException, createMethodMetadata, type Class, type IServiceProvider } from "@abp/core";
import type { AbpHttpContext } from "../http-context.js";

/** Port of `RequestDelegate`. */
export type RequestDelegate = (context: AbpHttpContext) => Promise<void>;

/** Port of `IMiddleware`: resolved from the request scope per invocation. */
export interface IAbpMiddleware {
  invoke(context: AbpHttpContext, next: RequestDelegate): Promise<void>;
}

/** Inline middleware (`app.Use((ctx, next) => ...)`). */
export type MiddlewareFunction = (context: AbpHttpContext, next: RequestDelegate) => Promise<void>;

export type MiddlewareRegistration = Class<IAbpMiddleware> | MiddlewareFunction;

/** Port of `[DisableAbpFeatures]` (controller attribute) read by `AbpMiddlewareBase.ShouldSkipAsync`. */
export interface DisableAbpFeaturesOptions {
  disableAuditing?: boolean;
  disableUnitOfWork?: boolean;
  disableMiddleware?: boolean;
}
const disableAbpFeaturesMetadata = createMethodMetadata<DisableAbpFeaturesOptions>("DisableAbpFeatures");

export function DisableAbpFeatures(options: DisableAbpFeaturesOptions = { disableAuditing: true, disableUnitOfWork: true, disableMiddleware: true }) {
  return (target: Class): void => {
    disableAbpFeaturesMetadata.setForClass(target, options);
  };
}

export function getDisableAbpFeatures(type: Class | undefined): DisableAbpFeaturesOptions | undefined {
  return disableAbpFeaturesMetadata.getForClass(type);
}

/** Port of `AbpMiddlewareBase`: `shouldSkip` honours `[DisableAbpFeatures(DisableMiddleware = true)]` on the endpoint's controller. */
export abstract class AbpMiddlewareBase implements IAbpMiddleware {
  protected async shouldSkip(context: AbpHttpContext): Promise<boolean> {
    return getDisableAbpFeatures(context.endpoint?.controllerType)?.disableMiddleware === true;
  }

  abstract invoke(context: AbpHttpContext, next: RequestDelegate): Promise<void>;
}

/** Names of the middlewares ABP configures, for `insertBefore`/`insertAfter`. */
export const AbpMiddlewareNames = {
  CorrelationId: "Abp.CorrelationId",
  ExceptionHandling: "Abp.ExceptionHandling",
  RequestLocalization: "Abp.RequestLocalization",
  Authentication: "Abp.Authentication",
  MultiTenancy: "Abp.MultiTenancy",
  Routing: "Abp.Routing",
  Auditing: "Abp.Auditing",
  UnitOfWork: "Abp.UnitOfWork",
  Endpoints: "Abp.Endpoints",
} as const;

export interface NamedMiddleware {
  readonly name: string;
  readonly middleware: MiddlewareRegistration;
}

/** Ordered middleware list (port of the `app.UseX()` calls of the ABP startup template, configurable by modules). */
export class MiddlewareList implements Iterable<NamedMiddleware> {
  private readonly items: NamedMiddleware[] = [];

  add(name: string, middleware: MiddlewareRegistration): this {
    this.items.push({ name, middleware });
    return this;
  }

  insertBefore(existingName: string, name: string, middleware: MiddlewareRegistration): this {
    const index = this.indexOf(existingName);
    this.items.splice(index, 0, { name, middleware });
    return this;
  }

  insertAfter(existingName: string, name: string, middleware: MiddlewareRegistration): this {
    const index = this.indexOf(existingName);
    this.items.splice(index + 1, 0, { name, middleware });
    return this;
  }

  replace(name: string, middleware: MiddlewareRegistration): this {
    const index = this.indexOf(name);
    this.items[index] = { name, middleware };
    return this;
  }

  remove(name: string): boolean {
    const index = this.items.findIndex((m) => m.name === name);
    if (index < 0) return false;
    this.items.splice(index, 1);
    return true;
  }

  contains(name: string): boolean {
    return this.items.some((m) => m.name === name);
  }

  get length(): number {
    return this.items.length;
  }

  private indexOf(name: string): number {
    const index = this.items.findIndex((m) => m.name === name);
    if (index < 0) throw new AbpException(`Middleware '${name}' is not in the pipeline.`);
    return index;
  }

  [Symbol.iterator](): Iterator<NamedMiddleware> {
    return this.items[Symbol.iterator]();
  }
}

/** Options modules use to shape the request pipeline (`AbpEndpointRouterOptions`-style). */
export class AbpRequestPipelineOptions {
  readonly middlewares = new MiddlewareList();
}

/**
 * The request pipeline: `use(...)` appends middleware (function or class resolved from the request scope);
 * `build()` composes the chain; `AbpRequestPipeline.fromOptions(provider)` starts from the module-configured list.
 */
export class AbpRequestPipeline {
  private readonly middlewares: MiddlewareRegistration[] = [];
  private terminal: RequestDelegate = async () => {};

  static fromOptions(provider: IServiceProvider): AbpRequestPipeline {
    const pipeline = new AbpRequestPipeline();
    for (const entry of provider.getOptions(AbpRequestPipelineOptions).middlewares) pipeline.use(entry.middleware);
    return pipeline;
  }

  use(middleware: MiddlewareRegistration): this {
    this.middlewares.push(middleware);
    return this;
  }

  /** The delegate invoked when no middleware handles the request (port of the 404 fallback). */
  run(terminal: RequestDelegate): this {
    this.terminal = terminal;
    return this;
  }

  build(): RequestDelegate {
    let next: RequestDelegate = this.terminal;
    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      const registration = this.middlewares[i]!;
      const following = next;
      next = (context) => invoke(registration, context, following);
    }
    return next;
  }
}

function invoke(registration: MiddlewareRegistration, context: AbpHttpContext, next: RequestDelegate): Promise<void> {
  if (isMiddlewareClass(registration)) {
    const instance = context.serviceProvider.get(registration) ?? new registration();
    return instance.invoke(context, next);
  }
  return registration(context, next);
}

function isMiddlewareClass(registration: MiddlewareRegistration): registration is Class<IAbpMiddleware> {
  return typeof registration.prototype === "object" && registration.prototype !== null && typeof (registration.prototype as IAbpMiddleware).invoke === "function";
}
