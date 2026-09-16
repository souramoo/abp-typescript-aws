import { AbpException, type IHasErrorCode, type IHasErrorDetails, type IHasHttpStatusCode } from "@abp/core";

/** Port of `RemoteServiceValidationErrorInfo`. */
export class RemoteServiceValidationErrorInfo {
  message: string;
  members: string[];

  constructor(message = "", members: string | string[] = []) {
    this.message = message;
    this.members = typeof members === "string" ? [members] : members;
  }
}

/** Port of `RemoteServiceErrorInfo`: the error body ABP sends (and its clients expect) for a failed remote call. */
export class RemoteServiceErrorInfo {
  code: string | undefined;
  message: string | undefined;
  details: string | undefined;
  data: Record<string, unknown> | undefined;
  validationErrors: RemoteServiceValidationErrorInfo[] | undefined;

  constructor(message?: string, details?: string, code?: string, data?: Record<string, unknown>) {
    this.message = message;
    this.details = details;
    this.code = code;
    this.data = data;
  }
}

/** Port of `RemoteServiceErrorResponse`: `{ "error": { ... } }`. */
export class RemoteServiceErrorResponse {
  constructor(public error: RemoteServiceErrorInfo) {}
}

/** Port of `AbpRemoteCallException`: thrown by HTTP clients when a remote service returns an error. */
export class AbpRemoteCallException extends AbpException implements IHasErrorCode, IHasErrorDetails, IHasHttpStatusCode {
  httpStatusCode = 0;
  error: RemoteServiceErrorInfo | undefined;
  readonly data: Record<string, unknown> = {};

  constructor(errorOrMessage?: RemoteServiceErrorInfo | string, options?: { cause?: unknown; httpStatusCode?: number }) {
    super(typeof errorOrMessage === "string" ? errorOrMessage : errorOrMessage?.message, { cause: options?.cause });
    if (typeof errorOrMessage === "object") {
      this.error = errorOrMessage;
      if (errorOrMessage.data) Object.assign(this.data, errorOrMessage.data);
    }
    if (options?.httpStatusCode !== undefined) this.httpStatusCode = options.httpStatusCode;
  }

  get code(): string | undefined {
    return this.error?.code;
  }

  get details(): string | undefined {
    return this.error?.details;
  }
}

/** Port of `ClientProxyExceptionEventData`. */
export interface ClientProxyExceptionEventData {
  statusCode?: number;
  reasonPhrase?: string;
  error?: string;
  errorDescription?: string;
  errorUri?: string;
}

/** Port of `System.NotImplementedException` (mapped to HTTP 501 by the status code finder). */
export class NotImplementedException extends AbpException {
  constructor(message = "The method or operation is not implemented.", options?: { cause?: unknown }) {
    super(message, options);
  }
}
