import {
  IServiceProviderToken,
  IStringLocalizerFactory,
  Transient,
  createToken,
  formatIndexed,
  hasErrorCode,
  hasErrorDetails,
  hasValidationErrors,
  isNullOrWhiteSpace,
  isUserFriendlyException,
  optionsToken,
  toCamelCase,
  type IHasValidationErrors,
  type IOptions,
  type IServiceProvider,
  type IStringLocalizer,
} from "@abp/core";
import { AbpDbConcurrencyException } from "@abp/data";
import { AbpExceptionLocalizationOptions } from "@abp/localization";
import { AbpValidationException } from "@abp/validation";
import { AbpRemoteCallException, RemoteServiceErrorInfo, RemoteServiceValidationErrorInfo } from "../remote-service-error-info.js";
import { AbpExceptionHandlingConsts, AbpExceptionHandlingOptions, matchesExceptionSelector } from "./abp-exception-handling-options.js";
import { AbpExceptionHandlingResource } from "./abp-exception-handling-resource.js";
import { LocalizationContext, entityTypeName, exceptionDataOf, isAggregateError, isEntityNotFoundException, isLocalizeErrorMessage, isUnwrappableInnerException, type EntityNotFoundLike } from "./exception-guards.js";

/** Port of `IExceptionToErrorInfoConverter`. */
export interface IExceptionToErrorInfoConverter {
  convert(exception: unknown, options?: (options: AbpExceptionHandlingOptions) => void): RemoteServiceErrorInfo;
}
export const IExceptionToErrorInfoConverter = createToken<IExceptionToErrorInfoConverter>("IExceptionToErrorInfoConverter");

/** Port of `DefaultExceptionToErrorInfoConverter`. */
@Transient(IExceptionToErrorInfoConverter)
export class DefaultExceptionToErrorInfoConverter implements IExceptionToErrorInfoConverter {
  static readonly inject = [optionsToken(AbpExceptionHandlingOptions), optionsToken(AbpExceptionLocalizationOptions), IStringLocalizerFactory, IServiceProviderToken] as const;

  protected readonly exceptionHandlingOptions: AbpExceptionHandlingOptions;
  protected readonly localizationOptions: AbpExceptionLocalizationOptions;
  protected readonly L: IStringLocalizer;

  constructor(
    exceptionHandlingOptions: IOptions<AbpExceptionHandlingOptions>,
    localizationOptions: IOptions<AbpExceptionLocalizationOptions>,
    protected readonly stringLocalizerFactory: IStringLocalizerFactory,
    protected readonly serviceProvider: IServiceProvider,
  ) {
    this.exceptionHandlingOptions = exceptionHandlingOptions.value;
    this.localizationOptions = localizationOptions.value;
    this.L = stringLocalizerFactory.create(AbpExceptionHandlingResource);
  }

  convert(exception: unknown, options?: (options: AbpExceptionHandlingOptions) => void): RemoteServiceErrorInfo {
    const exceptionHandlingOptions = this.createDefaultOptions();
    options?.(exceptionHandlingOptions);

    const errorInfo = this.createErrorInfoWithoutCode(exception, exceptionHandlingOptions);
    if (hasErrorCode(exception)) errorInfo.code = exception.code;
    return errorInfo;
  }

  protected createErrorInfoWithoutCode(exception: unknown, options: AbpExceptionHandlingOptions): RemoteServiceErrorInfo {
    if (options.sendExceptionsDetailsToClients) return this.createDetailedErrorInfoFromException(exception, options.sendStackTraceToClients);

    exception = this.tryToGetActualException(exception);

    if (exception instanceof AbpRemoteCallException && exception.error) {
      const remoteServiceErrorInfo = exception.error;
      if (remoteServiceErrorInfo.message === AbpExceptionHandlingConsts.Unauthorized) remoteServiceErrorInfo.message = this.L.t(AbpExceptionHandlingConsts.Unauthorized);
      if (remoteServiceErrorInfo.details === AbpExceptionHandlingConsts.SessionExpired) remoteServiceErrorInfo.details = this.L.t(AbpExceptionHandlingConsts.SessionExpired);
      return remoteServiceErrorInfo;
    }

    if (exception instanceof AbpDbConcurrencyException) return new RemoteServiceErrorInfo(this.L.t("AbpDbConcurrencyErrorMessage"));

    if (isEntityNotFoundException(exception)) return this.createEntityNotFoundError(exception);

    const errorInfo = new RemoteServiceErrorInfo();

    if (isUserFriendlyException(exception) || exception instanceof AbpRemoteCallException) {
      errorInfo.message = exception.message;
      errorInfo.details = hasErrorDetails(exception) ? exception.details : undefined;
    }

    if (hasValidationErrors(exception)) {
      if (isNullOrWhiteSpace(errorInfo.message)) errorInfo.message = this.L.t("ValidationErrorMessage");
      if (isNullOrWhiteSpace(errorInfo.details)) errorInfo.details = this.getValidationErrorNarrative(exception);
      errorInfo.validationErrors = this.getValidationErrorInfos(exception);
    }

    this.tryToLocalizeExceptionMessage(exception, errorInfo);

    if (isNullOrWhiteSpace(errorInfo.message)) errorInfo.message = this.L.t("InternalServerErrorMessage");

    if (options.sendExceptionDataToClientTypes.some((selector) => matchesExceptionSelector(selector, exception))) {
      errorInfo.data = exceptionDataOf(exception);
    }

    return errorInfo;
  }

  protected tryToLocalizeExceptionMessage(exception: unknown, errorInfo: RemoteServiceErrorInfo): void {
    if (isLocalizeErrorMessage(exception)) {
      const scope = this.serviceProvider.createScope();
      try {
        errorInfo.message = exception.localizeMessage(new LocalizationContext(scope.serviceProvider, this.stringLocalizerFactory));
      } finally {
        void scope.dispose();
      }
      return;
    }

    if (!hasErrorCode(exception)) return;
    const code = exception.code;
    if (isNullOrWhiteSpace(code) || !code.includes(":")) return;

    const codeNamespace = code.split(":")[0]!;
    const localizationResourceType = this.localizationOptions.errorCodeNamespaceMappings.get(codeNamespace);
    if (!localizationResourceType) return;

    const localizedString = this.stringLocalizerFactory.create(localizationResourceType).get(code);
    if (localizedString.resourceNotFound) return;

    let localizedValue = localizedString.value;
    const data = exceptionDataOf(exception);
    if (data) {
      for (const [key, value] of Object.entries(data)) {
        localizedValue = localizedValue.replaceAll(`{${key}}`, value === undefined || value === null ? "" : String(value));
      }
    }
    errorInfo.message = localizedValue;
  }

  protected createEntityNotFoundError(exception: EntityNotFoundLike): RemoteServiceErrorInfo {
    const typeName = entityTypeName(exception);
    if (typeName !== undefined) {
      const message =
        exception.id !== undefined && exception.id !== null
          ? formatIndexed(this.L.t("EntityNotFoundErrorMessage"), typeName, String(exception.id))
          : formatIndexed(this.L.t("EntityNotFoundErrorMessageWithoutId"), typeName);
      return new RemoteServiceErrorInfo(message);
    }
    return new RemoteServiceErrorInfo(exception.message);
  }

  protected tryToGetActualException(exception: unknown): unknown {
    if (isAggregateError(exception)) {
      const inner: unknown = exception.errors[0];
      if (inner !== undefined && isUnwrappableInnerException(inner)) return inner;
    }
    return exception;
  }

  protected createDetailedErrorInfoFromException(exception: unknown, sendStackTraceToClients: boolean): RemoteServiceErrorInfo {
    const lines: string[] = [];
    this.addExceptionToDetails(exception, lines, sendStackTraceToClients);

    const errorInfo = new RemoteServiceErrorInfo(messageOf(exception), lines.join("\n"), undefined, exceptionDataOf(exception));
    if (exception instanceof AbpValidationException) errorInfo.validationErrors = this.getValidationErrorInfos(exception);

    this.tryToLocalizeExceptionMessage(exception, errorInfo);
    return errorInfo;
  }

  protected addExceptionToDetails(exception: unknown, lines: string[], sendStackTraceToClients: boolean): void {
    lines.push(`${nameOf(exception)}: ${messageOf(exception)}`);

    if (isUserFriendlyException(exception) && hasErrorDetails(exception) && !isNullOrWhiteSpace(exception.details)) lines.push(exception.details);

    if (exception instanceof AbpValidationException && exception.validationErrors.length > 0) lines.push(this.getValidationErrorNarrative(exception));

    if (sendStackTraceToClients && exception instanceof Error && exception.stack) lines.push(`STACK TRACE: ${exception.stack}`);

    if (exception instanceof Error && exception.cause !== undefined) this.addExceptionToDetails(exception.cause, lines, sendStackTraceToClients);

    if (isAggregateError(exception)) {
      for (const inner of exception.errors) this.addExceptionToDetails(inner, lines, sendStackTraceToClients);
    }
  }

  protected getValidationErrorInfos(validationException: IHasValidationErrors): RemoteServiceValidationErrorInfo[] {
    return validationException.validationErrors.map((validationResult) => {
      const validationError = new RemoteServiceValidationErrorInfo(validationResult.errorMessage);
      if (validationResult.memberNames.length > 0) validationError.members = validationResult.memberNames.map(toCamelCase);
      return validationError;
    });
  }

  protected getValidationErrorNarrative(validationException: IHasValidationErrors): string {
    const lines = [this.L.t("ValidationNarrativeErrorMessageTitle")];
    for (const validationResult of validationException.validationErrors) lines.push(` - ${validationResult.errorMessage}`);
    return lines.join("\n") + "\n";
  }

  protected createDefaultOptions(): AbpExceptionHandlingOptions {
    const options = new AbpExceptionHandlingOptions();
    options.sendExceptionsDetailsToClients = this.exceptionHandlingOptions.sendExceptionsDetailsToClients;
    options.sendStackTraceToClients = this.exceptionHandlingOptions.sendStackTraceToClients;
    options.sendExceptionDataToClientTypes = this.exceptionHandlingOptions.sendExceptionDataToClientTypes;
    return options;
  }
}

function messageOf(exception: unknown): string {
  return exception instanceof Error ? exception.message : String(exception);
}

function nameOf(exception: unknown): string {
  return exception instanceof Error ? exception.name : typeof exception;
}
