import { serializeError, type Guid } from "@abp/core";
import { EntityChangeType } from "./contracts.js";

/** Port of `AuditLogActionInfo`. */
export class AuditLogActionInfo {
  serviceName = "";
  methodName = "";
  parameters = "{}";
  executionTime: Date = new Date(0);
  /** Milliseconds. */
  executionDuration = 0;
  readonly extraProperties = new Map<string, unknown>();
}

/** Port of `EntityPropertyChangeInfo`. */
export class EntityPropertyChangeInfo {
  /** Maximum length of `propertyName`. Value: 96. */
  static maxPropertyNameLength = 96;
  /** Maximum length of `newValue` and `originalValue`. Value: 512. */
  static maxValueLength = 512;
  /** Maximum length of `propertyTypeFullName`. Value: 512. */
  static maxPropertyTypeFullNameLength = 512;

  newValue: string | undefined;
  originalValue: string | undefined;
  propertyName = "";
  propertyTypeFullName = "";
}

/** Port of `EntityChangeInfo`. */
export class EntityChangeInfo {
  changeTime: Date = new Date(0);
  changeType: EntityChangeType = EntityChangeType.Created;
  /** TenantId of the related entity (not of the audit log entry; one log may contain changes of several tenants). */
  entityTenantId: Guid | undefined;
  entityId: string | undefined;
  entityTypeFullName: string | undefined;
  propertyChanges: EntityPropertyChangeInfo[] = [];
  readonly extraProperties = new Map<string, unknown>();
  /** The tracked entity (port of `EntityEntry`); not serializable. */
  entityEntry: unknown;

  merge(changeInfo: EntityChangeInfo): void {
    for (const propertyChange of changeInfo.propertyChanges) {
      const existing = this.propertyChanges.find((p) => p.propertyName === propertyChange.propertyName);
      if (existing) existing.newValue = propertyChange.newValue;
      else this.propertyChanges.push(propertyChange);
    }
    for (const [key, value] of changeInfo.extraProperties) {
      this.extraProperties.set(this.extraProperties.has(key) ? addCounter(key) : key, value);
    }
  }
}

/** Port of `InternalUtils.AddCounter`. */
export function addCounter(str: string): string {
  if (str.includes("__")) {
    const parts = str.split("__");
    if (parts.length === 2 && /^\d+$/.test(parts[1]!)) return `${parts[0]}__${Number(parts[1]) + 1}`;
  }
  return `${str}__2`;
}

/** Serializable form of a caught exception (what audit log stores persist instead of `Exception` objects). */
export interface ExceptionInfo {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly code?: string;
  readonly details?: string;
  readonly cause?: ExceptionInfo;
}

export function toExceptionInfo(error: unknown): ExceptionInfo {
  const serialized = serializeError(error) ?? { message: String(error) };
  const info: ExceptionInfo = {
    name: typeof serialized["name"] === "string" ? serialized["name"] : "Error",
    message: typeof serialized["message"] === "string" ? serialized["message"] : String(error),
    stack: typeof serialized["stack"] === "string" ? serialized["stack"] : undefined,
    code: typeof serialized["code"] === "string" ? serialized["code"] : undefined,
    details: typeof serialized["details"] === "string" ? serialized["details"] : undefined,
    cause: error instanceof Error && error.cause !== undefined ? toExceptionInfo(error.cause) : undefined,
  };
  return info;
}

/** Port of `AuditLogInfo`. */
export class AuditLogInfo {
  applicationName: string | undefined;
  userId: Guid | undefined;
  userName: string | undefined;
  tenantId: Guid | undefined;
  tenantName: string | undefined;
  impersonatorUserId: Guid | undefined;
  impersonatorTenantId: Guid | undefined;
  impersonatorUserName: string | undefined;
  impersonatorTenantName: string | undefined;
  executionTime: Date = new Date(0);
  /** Milliseconds. */
  executionDuration = 0;
  clientId: string | undefined;
  correlationId: string | undefined;
  clientIpAddress: string | undefined;
  clientName: string | undefined;
  browserInfo: string | undefined;
  httpMethod: string | undefined;
  httpStatusCode: number | undefined;
  url: string | undefined;
  actions: AuditLogActionInfo[] = [];
  readonly exceptions: unknown[] = [];
  readonly extraProperties = new Map<string, unknown>();
  readonly entityChanges: EntityChangeInfo[] = [];
  comments: string[] = [];

  /** Serialized form of `exceptions`. */
  getExceptionInfos(): ExceptionInfo[] {
    return this.exceptions.map(toExceptionInfo);
  }

  toString(): string {
    const lines: string[] = [];
    lines.push(`AUDIT LOG: [${this.httpStatusCode?.toString() ?? "---"}: ${(this.httpMethod ?? "-------").padEnd(7)}] ${this.url ?? ""}`);
    lines.push(`- UserName - UserId                 : ${this.userName ?? ""} - ${this.userId ?? ""}`);
    lines.push(`- ClientIpAddress        : ${this.clientIpAddress ?? ""}`);
    lines.push(`- ExecutionDuration      : ${this.executionDuration}`);

    if (this.actions.length > 0) {
      lines.push("- Actions:");
      for (const action of this.actions) {
        lines.push(`  - ${action.serviceName}.${action.methodName} (${action.executionDuration} ms.)`);
        lines.push(`    ${action.parameters}`);
      }
    }
    if (this.exceptions.length > 0) {
      lines.push("- Exceptions:");
      for (const exception of this.exceptions) {
        const info = toExceptionInfo(exception);
        lines.push(`  - ${info.message}`);
        lines.push(`    ${info.stack ?? `${info.name}: ${info.message}`}`);
      }
    }
    if (this.entityChanges.length > 0) {
      lines.push("- Entity Changes:");
      for (const entityChange of this.entityChanges) {
        lines.push(`  - [${EntityChangeType[entityChange.changeType]}] ${entityChange.entityTypeFullName ?? ""}, Id = ${entityChange.entityId ?? ""}`);
        for (const propertyChange of entityChange.propertyChanges) {
          lines.push(`    ${propertyChange.propertyName}: ${propertyChange.originalValue ?? ""} -> ${propertyChange.newValue ?? ""}`);
        }
      }
    }
    return lines.join("\n") + "\n";
  }
}

/** Port of `IAuditLogScope`. */
export interface IAuditLogScope {
  readonly log: AuditLogInfo;
}

/** Port of `AuditLogScope`. */
export class AuditLogScope implements IAuditLogScope {
  constructor(readonly log: AuditLogInfo) {}
}

/** Port of `IAuditLogSaveHandle`. */
export interface IAuditLogSaveHandle extends Disposable {
  save(): Promise<void>;
  dispose(): void;
}
