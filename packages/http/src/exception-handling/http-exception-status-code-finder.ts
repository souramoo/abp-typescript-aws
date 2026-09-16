import { Transient, createToken, hasErrorCode, hasHttpStatusCode, isBusinessException, isNullOrWhiteSpace, optionsToken, type IOptions } from "@abp/core";
import { AbpDbConcurrencyException } from "@abp/data";
import { AbpAuthorizationException } from "@abp/security";
import { AbpValidationException } from "@abp/validation";
import { HttpStatusCode } from "../abp-http-consts.js";
import { NotImplementedException } from "../remote-service-error-info.js";
import { AbpExceptionHttpStatusCodeOptions } from "./abp-exception-handling-options.js";
import { isEntityNotFoundException } from "./exception-guards.js";

/** What the finder needs from the HTTP context (`httpContext.User.Identity.IsAuthenticated`). */
export interface IHttpStatusCodeContext {
  readonly user: { readonly isAuthenticated: boolean };
}

/** Port of `IHttpExceptionStatusCodeFinder`. */
export interface IHttpExceptionStatusCodeFinder {
  getStatusCode(httpContext: IHttpStatusCodeContext | undefined, exception: unknown): HttpStatusCode;
}
export const IHttpExceptionStatusCodeFinder = createToken<IHttpExceptionStatusCodeFinder>("IHttpExceptionStatusCodeFinder");

/** Port of `DefaultHttpExceptionStatusCodeFinder`. */
@Transient(IHttpExceptionStatusCodeFinder)
export class DefaultHttpExceptionStatusCodeFinder implements IHttpExceptionStatusCodeFinder {
  static readonly inject = [optionsToken(AbpExceptionHttpStatusCodeOptions)] as const;
  protected readonly options: AbpExceptionHttpStatusCodeOptions;

  constructor(options: IOptions<AbpExceptionHttpStatusCodeOptions>) {
    this.options = options.value;
  }

  getStatusCode(httpContext: IHttpStatusCodeContext | undefined, exception: unknown): HttpStatusCode {
    if (hasHttpStatusCode(exception) && exception.httpStatusCode > 0) return exception.httpStatusCode as HttpStatusCode;

    if (hasErrorCode(exception) && !isNullOrWhiteSpace(exception.code)) {
      const status = this.options.errorCodeToHttpStatusCodeMappings.get(exception.code);
      if (status !== undefined) return status as HttpStatusCode;
    }

    if (exception instanceof AbpAuthorizationException) return httpContext?.user.isAuthenticated ? HttpStatusCode.Forbidden : HttpStatusCode.Unauthorized;
    if (exception instanceof AbpValidationException) return HttpStatusCode.BadRequest;
    if (isEntityNotFoundException(exception)) return HttpStatusCode.NotFound;
    if (exception instanceof AbpDbConcurrencyException) return HttpStatusCode.Conflict;
    if (exception instanceof NotImplementedException) return HttpStatusCode.NotImplemented;
    if (isBusinessException(exception)) return HttpStatusCode.Forbidden;
    return HttpStatusCode.InternalServerError;
  }
}
