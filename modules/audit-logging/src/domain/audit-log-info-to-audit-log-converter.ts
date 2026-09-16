import { Transient, createToken, optionsToken, type IOptions } from "@abp/core";
import type { AuditLogInfo } from "@abp/auditing";
import { IGuidGenerator } from "@abp/guids";
import { AbpExceptionHandlingOptions, IExceptionToErrorInfoConverter } from "@abp/http";
import { IJsonSerializer } from "@abp/json";
import { ExtraPropertyDictionary } from "@abp/object-extending";
import { AuditLog } from "./audit-log.js";
import { AuditLogAction } from "./audit-log-action.js";
import { AuditLogEntityTypeFullNameConverter } from "./audit-log-entity-type-full-name-converter.js";
import { EntityChange } from "./entity-change.js";

/** Port of `IAuditLogInfoToAuditLogConverter`. */
export interface IAuditLogInfoToAuditLogConverter {
  convert(auditLogInfo: AuditLogInfo): Promise<AuditLog>;
}
export const IAuditLogInfoToAuditLogConverter = createToken<IAuditLogInfoToAuditLogConverter>("IAuditLogInfoToAuditLogConverter");

/** Port of `AuditLogInfoToAuditLogConverter`: exceptions are stored as the JSON of their `RemoteServiceErrorInfo`s. */
@Transient(IAuditLogInfoToAuditLogConverter)
export class AuditLogInfoToAuditLogConverter implements IAuditLogInfoToAuditLogConverter {
  static readonly inject = [IGuidGenerator, IExceptionToErrorInfoConverter, IJsonSerializer, optionsToken(AbpExceptionHandlingOptions), AuditLogEntityTypeFullNameConverter] as const;
  protected readonly exceptionHandlingOptions: AbpExceptionHandlingOptions;

  constructor(
    protected readonly guidGenerator: IGuidGenerator,
    protected readonly exceptionToErrorInfoConverter: IExceptionToErrorInfoConverter,
    protected readonly jsonSerializer: IJsonSerializer,
    exceptionHandlingOptions: IOptions<AbpExceptionHandlingOptions>,
    protected readonly auditLogEntityTypeFullNameConverter: AuditLogEntityTypeFullNameConverter,
  ) {
    this.exceptionHandlingOptions = exceptionHandlingOptions.value;
  }

  async convert(auditLogInfo: AuditLogInfo): Promise<AuditLog> {
    const auditLogId = this.guidGenerator.create();

    const extraProperties = new ExtraPropertyDictionary(auditLogInfo.extraProperties);

    for (const entityChange of auditLogInfo.entityChanges) {
      if (entityChange.entityTypeFullName !== undefined) entityChange.entityTypeFullName = this.auditLogEntityTypeFullNameConverter.convert(entityChange.entityTypeFullName);
      for (const propertyChange of entityChange.propertyChanges) {
        propertyChange.propertyTypeFullName = this.auditLogEntityTypeFullNameConverter.convert(propertyChange.propertyTypeFullName);
      }
    }

    const entityChanges = auditLogInfo.entityChanges.map((entityChangeInfo) => new EntityChange(this.guidGenerator, auditLogId, entityChangeInfo, auditLogInfo.tenantId));
    const actions = auditLogInfo.actions.map((auditLogActionInfo) => new AuditLogAction(this.guidGenerator.create(), auditLogId, auditLogActionInfo, auditLogInfo.tenantId));

    const remoteServiceErrorInfos = auditLogInfo.exceptions.map((exception) =>
      this.exceptionToErrorInfoConverter.convert(exception, (options) => {
        options.sendExceptionsDetailsToClients = this.exceptionHandlingOptions.sendExceptionsDetailsToClients;
        options.sendStackTraceToClients = this.exceptionHandlingOptions.sendStackTraceToClients;
        options.sendExceptionDataToClientTypes = this.exceptionHandlingOptions.sendExceptionDataToClientTypes;
      }),
    );
    const exceptions = remoteServiceErrorInfos.length > 0 ? this.jsonSerializer.serialize(remoteServiceErrorInfos, { indented: true }) : undefined;

    const comments = auditLogInfo.comments.length > 0 ? auditLogInfo.comments.join("\n") : undefined;

    return new AuditLog({
      id: auditLogId,
      applicationName: auditLogInfo.applicationName,
      tenantId: auditLogInfo.tenantId,
      tenantName: auditLogInfo.tenantName,
      userId: auditLogInfo.userId,
      userName: auditLogInfo.userName,
      executionTime: auditLogInfo.executionTime,
      executionDuration: auditLogInfo.executionDuration,
      clientIpAddress: auditLogInfo.clientIpAddress,
      clientName: auditLogInfo.clientName,
      clientId: auditLogInfo.clientId,
      correlationId: auditLogInfo.correlationId,
      browserInfo: auditLogInfo.browserInfo,
      httpMethod: auditLogInfo.httpMethod,
      url: auditLogInfo.url,
      httpStatusCode: auditLogInfo.httpStatusCode,
      impersonatorUserId: auditLogInfo.impersonatorUserId,
      impersonatorUserName: auditLogInfo.impersonatorUserName,
      impersonatorTenantId: auditLogInfo.impersonatorTenantId,
      impersonatorTenantName: auditLogInfo.impersonatorTenantName,
      extraProperties,
      entityChanges,
      actions,
      exceptions,
      comments,
    });
  }
}
