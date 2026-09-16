import { ExceptionNotificationContext, IExceptionNotifier, ILoggerFactory, LogLevel, Transient, createToken, hasLogLevel, optionsToken, type ILogger, type IOptions } from "@abp/core";
import { AbpExceptionHandlingOptions, AbpHttpConsts, HttpStatusCode, IExceptionToErrorInfoConverter, IHttpExceptionStatusCodeFinder, RemoteServiceErrorResponse, type RemoteServiceErrorInfo } from "@abp/http";
import { IJsonSerializer } from "@abp/json";
import { AbpAuthorizationException } from "@abp/security";
import type { AbpHttpContext } from "../http-context.js";
import { AbpAuthenticationOptions, resolveAuthenticationHandler } from "./authentication.js";
import { AbpMiddlewareBase, type RequestDelegate } from "./pipeline.js";

/** Port of `AbpAuthorizationExceptionHandlerOptions`. */
export class AbpAuthorizationExceptionHandlerOptions {
  /** The authentication scheme used to challenge/forbid; defaults to the first configured scheme. */
  authenticationScheme: string | undefined;
}

/** Port of `IAbpAuthorizationExceptionHandler`. */
export interface IAbpAuthorizationExceptionHandler {
  handle(exception: AbpAuthorizationException, httpContext: AbpHttpContext, errorInfo: RemoteServiceErrorInfo): Promise<void>;
}
export const IAbpAuthorizationExceptionHandler = createToken<IAbpAuthorizationExceptionHandler>("IAbpAuthorizationExceptionHandler");

/**
 * Port of `DefaultAbpAuthorizationExceptionHandler`: 401 (challenge) for anonymous, 403 (forbid) for authenticated
 * users, delegating headers such as `WWW-Authenticate` to the scheme's handler. Unlike ASP.NET Core, the error body
 * (`RemoteServiceErrorResponse`) is written too, so API clients always get a JSON error.
 */
@Transient(IAbpAuthorizationExceptionHandler)
export class DefaultAbpAuthorizationExceptionHandler implements IAbpAuthorizationExceptionHandler {
  static readonly inject = [optionsToken(AbpAuthorizationExceptionHandlerOptions), optionsToken(AbpAuthenticationOptions), IJsonSerializer] as const;
  private readonly options: AbpAuthorizationExceptionHandlerOptions;
  private readonly authenticationOptions: AbpAuthenticationOptions;

  constructor(
    options: IOptions<AbpAuthorizationExceptionHandlerOptions>,
    authenticationOptions: IOptions<AbpAuthenticationOptions>,
    private readonly jsonSerializer: IJsonSerializer,
  ) {
    this.options = options.value;
    this.authenticationOptions = authenticationOptions.value;
  }

  async handle(exception: AbpAuthorizationException, httpContext: AbpHttpContext, errorInfo: RemoteServiceErrorInfo): Promise<void> {
    const isAuthenticated = httpContext.user.isAuthenticated;
    const schemeName = this.options.authenticationScheme ?? this.authenticationOptions.defaultChallengeScheme ?? this.authenticationOptions.schemes[0]?.name;
    const handler = schemeName ? resolveAuthenticationHandler(httpContext.serviceProvider, this.authenticationOptions, schemeName) : undefined;

    httpContext.response.statusCode = isAuthenticated ? HttpStatusCode.Forbidden : HttpStatusCode.Unauthorized;
    if (isAuthenticated) await handler?.forbid?.(httpContext);
    else await handler?.challenge?.(httpContext);

    httpContext.response.headers.tryAdd(AbpHttpConsts.AbpErrorFormat, "true");
    await httpContext.response.json(new RemoteServiceErrorResponse(errorInfo), this.jsonSerializer);
  }
}

function logLevelOf(exception: unknown): LogLevel {
  return hasLogLevel(exception) ? exception.logLevel : LogLevel.Error;
}

/**
 * Port of the shared part of `AbpExceptionFilter.HandleAndWrapException` / `AbpExceptionHandlingMiddleware`:
 * logs, notifies `IExceptionNotifier` and writes a `RemoteServiceErrorResponse` with the mapped status code.
 */
export async function handleAndWrapException(context: AbpHttpContext, exception: unknown, logger: ILogger): Promise<void> {
  const provider = context.serviceProvider;
  const exceptionHandlingOptions = provider.getOptions(AbpExceptionHandlingOptions);
  const errorInfo = provider.getRequired(IExceptionToErrorInfoConverter).convert(exception, (options) => {
    options.sendExceptionsDetailsToClients = exceptionHandlingOptions.sendExceptionsDetailsToClients;
    options.sendStackTraceToClients = exceptionHandlingOptions.sendStackTraceToClients;
    options.sendExceptionDataToClientTypes = exceptionHandlingOptions.sendExceptionDataToClientTypes;
  });
  const jsonSerializer = provider.getRequired(IJsonSerializer);

  if (exceptionHandlingOptions.shouldLogException(exception)) {
    const logLevel = logLevelOf(exception);
    logger.log(logLevel, `---------- RemoteServiceErrorInfo ----------\n${jsonSerializer.serialize(errorInfo, { indented: true })}`);
    logger.logException(exception, logLevel);
  }

  await provider.getRequired(IExceptionNotifier).notify(new ExceptionNotificationContext(exception));

  if (context.response.hasStarted) {
    logger.warn("HTTP response has already started, cannot set headers and status code!");
    return;
  }

  context.response.clear();
  if (exception instanceof AbpAuthorizationException) {
    await provider.getRequired(IAbpAuthorizationExceptionHandler).handle(exception, context, errorInfo);
    return;
  }

  context.response.statusCode = provider.getRequired(IHttpExceptionStatusCodeFinder).getStatusCode(context, exception);
  context.response.headers.set("cache-control", "no-cache");
  context.response.headers.set("pragma", "no-cache");
  context.response.headers.set("expires", "-1");
  context.response.headers.set(AbpHttpConsts.AbpErrorFormat, "true");
  await context.response.json(new RemoteServiceErrorResponse(errorInfo), jsonSerializer);
}

/** Port of `AbpExceptionHandlingMiddleware`: the outermost catch that turns any escaped exception into an ABP error response. */
@Transient()
export class AbpExceptionHandlingMiddleware extends AbpMiddlewareBase {
  static readonly inject = [ILoggerFactory] as const;
  private readonly logger: ILogger;

  constructor(loggerFactory: ILoggerFactory) {
    super();
    this.logger = loggerFactory.createLogger(AbpExceptionHandlingMiddleware.name);
  }

  override async invoke(context: AbpHttpContext, next: RequestDelegate): Promise<void> {
    try {
      await next(context);
    } catch (e) {
      if (context.response.hasStarted) {
        this.logger.warn("An exception occurred, but response has already started!");
        throw e;
      }
      await handleAndWrapException(context, e, this.logger);
    }
  }
}
