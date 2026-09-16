import { AbpCrossCuttingConcerns, AbpException, AppliedCrossCuttingConcerns, ILoggerFactory, IStringLocalizerFactory, Singleton, Transient, optionsToken, type Class, type ILogger, type IOptions, type IServiceProvider } from "@abp/core";
import { AbpAuditingOptions, IAuditingHelper, IAuditingManager, isIntegrationService, type AuditLogActionInfo } from "@abp/auditing";
import { AbpExceptionHandlingResource, AbpHttpConsts, HttpMethodHelper, HttpStatusCode, MimeTypes, RemoteServiceErrorInfo, RemoteServiceErrorResponse } from "@abp/http";
import { IJsonSerializer } from "@abp/json";
import { AbpUnitOfWorkDefaultOptions, AbpUnitOfWorkOptions, IAmbientUnitOfWork, IUnitOfWorkManager, UnitOfWorkHelper, UnitOfWorkReservationName, applyUnitOfWorkAttribute } from "@abp/uow";
import { IMethodInvocationValidator, MethodInvocationValidationContext, ValidationEnabled, ValidationMetadata } from "@abp/validation";
import { HttpResult, type AbpHttpContext, type RouteEndpoint } from "../http-context.js";
import { handleAndWrapException } from "../middleware/exception-handling.js";
import { AbpMiddlewareBase, getDisableAbpFeatures, type RequestDelegate } from "../middleware/pipeline.js";
import { AbpAspNetCoreMvcOptions } from "./abp-aspnetcore-mvc-options.js";
import { getActions, getControllerMetadata, type ActionMetadata } from "./controller.js";
import { ModelState, ModelStateValidator, bindParameters } from "./model-binder.js";
import { Router, buildRouteTable, type RouteEntry } from "./router.js";

/** Builds the route table once from `AbpAspNetCoreMvcOptions.controllers` (port of the endpoint data source). */
@Singleton()
export class AbpRouteTableProvider {
  static readonly inject = [optionsToken(AbpAspNetCoreMvcOptions)] as const;
  private router: Router | undefined;

  constructor(private readonly options: IOptions<AbpAspNetCoreMvcOptions>) {}

  get value(): Router {
    this.router ??= new Router(buildRouteTable(this.controllerTypes()));
    return this.router;
  }

  controllerTypes(): Class[] {
    const options = this.options.value;
    return options.controllers.toArray().filter((type) => !options.controllersToRemove.has(type) && (options.exposeIntegrationServices || !isIntegrationService(type)));
  }

  /** Forces a rebuild (e.g. after controllers were added at runtime). */
  reset(): void {
    this.router = undefined;
  }
}

export const AllowedMethodsItemName = "__AbpAllowedMethods";
export const RouteEntryItemName = "__AbpRouteEntry";

/** Port of `UseRouting`: selects the endpoint and fills the route values without executing it. */
@Transient()
export class AbpRoutingMiddleware extends AbpMiddlewareBase {
  static readonly inject = [AbpRouteTableProvider] as const;

  constructor(private readonly routeTable: AbpRouteTableProvider) {
    super();
  }

  override async invoke(context: AbpHttpContext, next: RequestDelegate): Promise<void> {
    const match = this.routeTable.value.match(context.request.method, context.request.path);
    switch (match.kind) {
      case "matched":
        context.endpoint = match.endpoint;
        context.request.routeValues = { ...match.endpoint.routeValues };
        context.items.set(RouteEntryItemName, match.entry);
        break;
      case "methodNotAllowed":
        context.items.set(AllowedMethodsItemName, match.allowedMethods);
        break;
      case "notFound":
        break;
      default: {
        const _exhaustive: never = match;
        throw new AbpException(`Unknown match ${String(_exhaustive)}`);
      }
    }
    await next(context);
  }
}

/**
 * Port of `UseEndpoints` + the MVC action pipeline ABP configures (`AbpAuditActionFilter`, `AbpNoContentActionFilter`,
 * `AbpValidationActionFilter`, `AbpUowActionFilter`, `AbpExceptionFilter`). Feature/authorization checks come from the
 * interceptors applied to controllers resolved from DI (`@RequiresFeature`, `@Authorize`).
 */
@Transient()
export class AbpEndpointMiddleware extends AbpMiddlewareBase {
  static readonly inject = [ILoggerFactory] as const;
  private readonly logger: ILogger;

  constructor(loggerFactory: ILoggerFactory) {
    super();
    this.logger = loggerFactory.createLogger(AbpEndpointMiddleware.name);
  }

  override async invoke(context: AbpHttpContext, next: RequestDelegate): Promise<void> {
    const endpoint = context.endpoint;
    if (!endpoint) {
      const allowed = context.items.get(AllowedMethodsItemName) as readonly string[] | undefined;
      if (allowed) {
        context.response.statusCode = HttpStatusCode.MethodNotAllowed;
        context.response.headers.set("allow", allowed.join(", "));
        await writeErrorResponse(context, HttpStatusCode.MethodNotAllowed, `The ${context.request.method} method is not allowed for ${context.request.path}.`);
        return;
      }
      await next(context);
      return;
    }

    const entry = context.items.get(RouteEntryItemName) as RouteEntry;
    try {
      await this.executeAction(context, endpoint, entry.action);
    } catch (e) {
      await handleAndWrapException(context, e, this.logger);
    }
  }

  protected async executeAction(context: AbpHttpContext, endpoint: RouteEndpoint, action: ActionMetadata): Promise<void> {
    const controller = context.serviceProvider.get(endpoint.controllerType);
    if (!controller) {
      throw new AbpException(`Controller ${endpoint.controllerType.name} is not registered in the service collection. Decorate it with @Transient() or add it to AbpAspNetCoreMvcOptions.controllers.`);
    }

    const method = (controller as Record<string, unknown>)[action.name];
    if (typeof method !== "function") throw new AbpException(`Action ${endpoint.controllerType.name}.${action.name} is not a method.`);

    const provider = context.serviceProvider;
    const audit = new AuditActionFilter(provider);
    const validation = new ValidationActionFilter(provider);
    const uow = new UowActionFilter(provider);

    await audit.run(context, endpoint, action, controller, async (args) => {
      await validation.run(context, endpoint, action, controller, args, async () => {
        await uow.run(context, endpoint, action, async () => {
          const result: unknown = await (method as (...a: unknown[]) => unknown).apply(controller, args);
          await this.writeResult(context, result);
        });
      });
    });
  }

  /** Port of the output formatting + `AbpNoContentActionFilter`. */
  protected async writeResult(context: AbpHttpContext, result: unknown): Promise<void> {
    const response = context.response;
    if (result instanceof HttpResult) {
      await result.apply(response, context.jsonSerializer);
      return;
    }
    if (result === undefined || result === null) {
      if (response.statusCode === HttpStatusCode.OK && !response.hasStarted) response.noContent();
      return;
    }
    if (typeof result === "string") {
      await response.text(result);
      return;
    }
    if (result instanceof Uint8Array) {
      await response.write(result, MimeTypes.Application.OctetStream);
      return;
    }
    await response.json(result, context.jsonSerializer);
  }
}

async function writeErrorResponse(context: AbpHttpContext, statusCode: number, message: string, details?: string): Promise<void> {
  context.response.statusCode = statusCode;
  context.response.headers.set(AbpHttpConsts.AbpErrorFormat, "true");
  const serializer = context.serviceProvider.getRequired(IJsonSerializer);
  await context.response.json(new RemoteServiceErrorResponse(new RemoteServiceErrorInfo(message, details)), serializer);
}

/** Port of the terminal 404 of the endpoint pipeline, as an ABP error response (`DefaultErrorMessage404`). */
export async function notFoundTerminal(context: AbpHttpContext): Promise<void> {
  const L = context.serviceProvider.get(IStringLocalizerFactory)?.create(AbpExceptionHandlingResource);
  await writeErrorResponse(context, HttpStatusCode.NotFound, L?.t("DefaultErrorMessage404") ?? "Resource not found!", L?.t("DefaultErrorMessage404Detail") ?? "The resource requested could not be found on the server!");
}

/** Port of `AbpAuditActionFilter`. */
class AuditActionFilter {
  constructor(private readonly provider: IServiceProvider) {}

  async run(context: AbpHttpContext, endpoint: RouteEndpoint, action: ActionMetadata, controller: object, next: (args: unknown[]) => Promise<void>): Promise<void> {
    const args = this.bind(context, action);
    const options = this.provider.getOptions(AbpAuditingOptions);
    const disabled = getDisableAbpFeatures(endpoint.controllerType)?.disableAuditing === true;
    const scope = options.isEnabled && !disabled ? this.provider.getRequired(IAuditingManager).current : undefined;
    if (!scope) {
      await next(args);
      return;
    }

    const auditingHelper = this.provider.getRequired(IAuditingHelper);
    const defaultValue = !(!options.isEnabledForIntegrationServices && isIntegrationService(endpoint.controllerType));
    if (!auditingHelper.shouldSaveAudit(endpoint.controllerType, action.name, defaultValue)) {
      await next(args);
      return;
    }

    const auditLog = scope.log;
    let auditLogAction: AuditLogActionInfo | undefined;
    if (!options.disableLogActionInfo) auditLogAction = auditingHelper.createAuditLogAction(auditLog, endpoint.controllerType, action.name, args);

    using _ = AppliedCrossCuttingConcerns.apply(controller, AbpCrossCuttingConcerns.Auditing);
    const startedAt = performance.now();
    try {
      await next(args);
    } catch (e) {
      if (!auditLog.exceptions.includes(e)) auditLog.exceptions.push(e);
      throw e;
    } finally {
      if (auditLogAction) {
        auditLogAction.executionDuration = Math.round(performance.now() - startedAt);
        auditLog.actions.push(auditLogAction);
      }
    }
  }

  /** Model binding happens before the filters so the audit action can record the arguments (`ActionArguments`). */
  private bind(context: AbpHttpContext, action: ActionMetadata): unknown[] {
    const modelState = new ModelState();
    const args = bindParameters(context, action.bindings, modelState);
    context.items.set(ModelStateItemName, modelState);
    return args;
  }
}

export const ModelStateItemName = "__AbpModelState";

/** Port of `AbpValidationActionFilter` (+ `ModelStateValidator`). */
class ValidationActionFilter {
  constructor(private readonly provider: IServiceProvider) {}

  async run(context: AbpHttpContext, endpoint: RouteEndpoint, action: ActionMetadata, controller: object, args: unknown[], next: () => Promise<void>): Promise<void> {
    const options = this.provider.getOptions(AbpAspNetCoreMvcOptions);
    const type = endpoint.controllerType;
    if (!options.autoModelValidation || ValidationMetadata.isDisabledForMethod(type, action.name) || ValidationMetadata.isDisabledForClass(type)) {
      await next();
      return;
    }

    const modelState = context.items.get(ModelStateItemName) as ModelState | undefined;
    if (modelState) ModelStateValidator.validate(modelState);

    if (ValidationEnabled.has(type)) {
      await this.provider.getRequired(IMethodInvocationValidator).validateAsync(new MethodInvocationValidationContext(controller, type, action.name, args));
    }

    await next();
  }
}

/** Port of `AbpUowActionFilter`: begins the reserved request unit of work (or a new one) around the action. */
class UowActionFilter {
  constructor(private readonly provider: IServiceProvider) {}

  async run(context: AbpHttpContext, endpoint: RouteEndpoint, action: ActionMetadata, next: () => Promise<void>): Promise<void> {
    const unitOfWorkAttr = UnitOfWorkHelper.getUnitOfWorkAttributeOrNull(endpoint.controllerType, action.name);
    context.items.set("_AbpActionInfo", { isObjectResult: true });

    if (unitOfWorkAttr?.isDisabled === true || getDisableAbpFeatures(endpoint.controllerType)?.disableUnitOfWork === true) {
      await next();
      return;
    }

    const options = this.createOptions(context, unitOfWorkAttr);
    const unitOfWorkManager = this.provider.getRequired(IUnitOfWorkManager);

    if (unitOfWorkManager.tryBeginReserved(UnitOfWorkReservationName, options)) {
      try {
        await next();
      } catch (e) {
        await unitOfWorkManager.current?.rollback();
        throw e;
      }
      await this.saveChanges(unitOfWorkManager);
      return;
    }

    await this.provider.getRequired(IAmbientUnitOfWork).fork(async () => {
      const uow = unitOfWorkManager.begin(options);
      try {
        await next();
        await uow.complete();
      } catch (e) {
        await uow.rollback();
        throw e;
      } finally {
        await uow.dispose();
      }
    });
  }

  private createOptions(context: AbpHttpContext, unitOfWorkAttribute: ReturnType<typeof UnitOfWorkHelper.getUnitOfWorkAttributeOrNull>): AbpUnitOfWorkOptions {
    const options = new AbpUnitOfWorkOptions();
    if (unitOfWorkAttribute) applyUnitOfWorkAttribute(unitOfWorkAttribute, options);
    if (unitOfWorkAttribute?.isTransactional === undefined) {
      const defaults = this.provider.getOptions(AbpUnitOfWorkDefaultOptions);
      const method = context.request.method;
      options.isTransactional = defaults.calculateIsTransactional(!(HttpMethodHelper.isGet(method) || HttpMethodHelper.isQuery(method)));
    }
    return options;
  }

  private async saveChanges(unitOfWorkManager: IUnitOfWorkManager): Promise<void> {
    const currentUow = unitOfWorkManager.current;
    if (!currentUow) return;
    try {
      await currentUow.saveChanges();
    } catch (e) {
      await currentUow.rollback();
      throw e;
    }
  }
}

/** Controller name in URLs/API descriptions: class name without the `Controller` suffix (port of `ControllerModel.ControllerName`). */
export function controllerNameOf(type: Class): string {
  return type.name.replace(/Controller$/, "");
}

export { getActions, getControllerMetadata };
