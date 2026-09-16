import { IAmbientScopeProvider, ILoggerFactory, IRootServiceProvider, LogLevel, Transient, createToken, getMethodNames, getRemoteServiceMetadata, optionsToken, type Class, type ILogger, type IOptions, type IServiceProvider } from "@abp/core";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { ICurrentClient, ICurrentUser, findImpersonatorTenantId, findImpersonatorTenantName, findImpersonatorUserId, findImpersonatorUserName } from "@abp/security";
import { IClock } from "@abp/timing";
import { AbpAuditingOptions, AuditLogContributionContext } from "./abp-auditing-options.js";
import { AuditLogActionInfo, AuditLogInfo } from "./audit-log-info.js";
import { IAuditSerializer, isInstanceOfAny } from "./audit-serializer.js";
import { IAuditingStore } from "./auditing-store.js";
import { AuditedMetadata, AuditingEnabled, DisableAuditingMetadata, getAuditedMembers } from "./contracts.js";

/** Port of `AuditingDisabledState`. */
export class AuditingDisabledState {
  constructor(readonly isDisabled: boolean) {}
}

/** Port of `IAuditingHelper`. Methods are identified by `(type, methodName)` instead of `MethodInfo`. */
export interface IAuditingHelper {
  shouldSaveAudit(type: Class | undefined, method: string | undefined, defaultValue?: boolean, ignoreIntegrationServiceAttribute?: boolean): boolean;
  isEntityHistoryEnabled(entityType: Class, defaultValue?: boolean): boolean;
  createAuditLogInfo(): AuditLogInfo;
  createAuditLogAction(auditLog: AuditLogInfo, type: Class | undefined, method: string, args: readonly unknown[] | Readonly<Record<string, unknown>>): AuditLogActionInfo;
  /** Disposable style (`using`): auditing is disabled for the rest of the async flow until disposed. */
  disableAuditing(): Disposable;
  /** Callback style: auditing is disabled only inside `fn`. */
  runWithAuditingDisabled<R>(fn: () => R): R;
  isAuditingEnabled(): boolean;
}
export const IAuditingHelper = createToken<IAuditingHelper>("IAuditingHelper");

/** Port of `IntegrationServiceAttribute.IsDefinedOrInherited`. */
export function isIntegrationService(type: Class | undefined): boolean {
  let current: unknown = type;
  while (typeof current === "function" && current !== Function.prototype) {
    if (getRemoteServiceMetadata(current)?.name === "integration") return true;
    current = Object.getPrototypeOf(current);
  }
  return false;
}

/** Port of `AuditingInterceptorRegistrar.ShouldAuditTypeByDefaultOrNull`. */
export function shouldAuditTypeByDefaultOrNull(type: Class | undefined, ignoreIntegrationServiceAttribute: boolean): boolean | undefined {
  if (AuditedMetadata.getForClass(type) !== undefined) return true;
  if (DisableAuditingMetadata.getForClass(type) !== undefined) return false;
  if (AuditingEnabled.has(type) && (ignoreIntegrationServiceAttribute || !isIntegrationService(type))) return true;
  return undefined;
}

const AuditingDisabledScopeKey = "Volo.Abp.Auditing.DisabledScope";

/** Port of `AuditingHelper`. */
@Transient(IAuditingHelper)
export class AuditingHelper implements IAuditingHelper {
  static readonly inject = [IAuditSerializer, optionsToken(AbpAuditingOptions), ICurrentUser, ICurrentTenant, ICurrentClient, IClock, IAuditingStore, ILoggerFactory, IRootServiceProvider, IAmbientScopeProvider] as const;

  protected readonly options: AbpAuditingOptions;
  protected readonly logger: ILogger;

  constructor(
    protected readonly auditSerializer: IAuditSerializer,
    options: IOptions<AbpAuditingOptions>,
    protected readonly currentUser: ICurrentUser,
    protected readonly currentTenant: ICurrentTenant,
    protected readonly currentClient: ICurrentClient,
    protected readonly clock: IClock,
    protected readonly auditingStore: IAuditingStore,
    loggerFactory: ILoggerFactory,
    protected readonly serviceProvider: IServiceProvider,
    protected readonly auditingDisabledState: IAmbientScopeProvider<AuditingDisabledState>,
  ) {
    this.options = options.value;
    this.logger = loggerFactory.createLogger(AuditingHelper.name);
  }

  shouldSaveAudit(type: Class | undefined, method: string | undefined, defaultValue = false, ignoreIntegrationServiceAttribute = false): boolean {
    if (!type || !method) return false;
    if (!isPublicMethod(type, method)) return false;
    if (!this.isAuditingEnabled()) return false;
    if (AuditedMetadata.get(type, method) !== undefined) return true;
    if (DisableAuditingMetadata.get(type, method) !== undefined) return false;

    const shouldAudit = shouldAuditTypeByDefaultOrNull(type, ignoreIntegrationServiceAttribute);
    if (shouldAudit !== undefined) return shouldAudit;
    return defaultValue;
  }

  isEntityHistoryEnabled(entityType: Class, defaultValue = false): boolean {
    if (this.options.ignoredTypes.some((t) => entityType === t || entityType.prototype instanceof t)) return false;
    if (AuditedMetadata.getForClass(entityType) !== undefined) return true;
    if (getAuditedMembers(entityType).length > 0) return true;
    if (DisableAuditingMetadata.getForClass(entityType) !== undefined) return false;
    if (this.options.entityHistorySelectors.some((selector) => selector.predicate(entityType))) return true;
    return defaultValue;
  }

  createAuditLogInfo(): AuditLogInfo {
    const auditInfo = new AuditLogInfo();
    auditInfo.applicationName = this.options.applicationName;
    auditInfo.tenantId = this.currentTenant.id;
    auditInfo.tenantName = this.currentTenant.name;
    auditInfo.userId = this.currentUser.id;
    auditInfo.userName = this.currentUser.userName;
    auditInfo.clientId = this.currentClient.id;
    auditInfo.executionTime = this.clock.now;
    auditInfo.impersonatorUserId = findImpersonatorUserId(this.currentUser);
    auditInfo.impersonatorUserName = findImpersonatorUserName(this.currentUser);
    auditInfo.impersonatorTenantId = findImpersonatorTenantId(this.currentUser);
    auditInfo.impersonatorTenantName = findImpersonatorTenantName(this.currentUser);

    this.executePreContributors(auditInfo);
    return auditInfo;
  }

  createAuditLogAction(auditLog: AuditLogInfo, type: Class | undefined, method: string, args: readonly unknown[] | Readonly<Record<string, unknown>>): AuditLogActionInfo {
    const actionInfo = new AuditLogActionInfo();
    actionInfo.serviceName = type?.name ?? "";
    actionInfo.methodName = method;
    actionInfo.parameters = this.serializeConvertArguments(Array.isArray(args) ? this.createArgumentsDictionary(type, method, args) : (args as Readonly<Record<string, unknown>>));
    actionInfo.executionTime = this.clock.now;
    return actionInfo;
  }

  disableAuditing(): Disposable {
    return this.auditingDisabledState.beginScope(AuditingDisabledScopeKey, new AuditingDisabledState(true));
  }

  runWithAuditingDisabled<R>(fn: () => R): R {
    return this.auditingDisabledState.run(AuditingDisabledScopeKey, new AuditingDisabledState(true), fn);
  }

  isAuditingEnabled(): boolean {
    const state = this.auditingDisabledState.getValue(AuditingDisabledScopeKey);
    return state === undefined || !state.isDisabled;
  }

  protected executePreContributors(auditLogInfo: AuditLogInfo): void {
    const context = new AuditLogContributionContext(this.serviceProvider, auditLogInfo);
    for (const contributor of this.options.contributors) {
      try {
        contributor.preContribute(context);
      } catch (e) {
        this.logger.logException(e, LogLevel.Warning);
      }
    }
  }

  /** Port of `SerializeConvertArguments` (`AuditingHelper.serializeConvertArguments` in the porting notes). */
  serializeConvertArguments(args: Readonly<Record<string, unknown>>): string {
    try {
      const entries = Object.entries(args);
      if (entries.length === 0) return "{}";
      const dictionary: Record<string, unknown> = {};
      for (const [key, value] of entries) dictionary[key] = isInstanceOfAny(value, this.options.ignoredTypes) ? null : value;
      return this.auditSerializer.serialize(dictionary);
    } catch (e) {
      this.logger.logException(e, LogLevel.Warning);
      return "{}";
    }
  }

  /** Port of `CreateArgumentsDictionary`: parameter names come from the method source, falling back to `arg{i}`. */
  protected createArgumentsDictionary(type: Class | undefined, method: string, args: readonly unknown[]): Record<string, unknown> {
    const names = getParameterNames(type, method);
    const dictionary: Record<string, unknown> = {};
    args.forEach((value, i) => {
      dictionary[names[i] ?? `arg${i}`] = value;
    });
    return dictionary;
  }
}

function isPublicMethod(type: Class, method: string): boolean {
  if (method.startsWith("_") || method.startsWith("#")) return false;
  return getMethodNames(type).includes(method);
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** Best-effort parameter names of `type.prototype[method]` (undefined entries for destructured/rest parameters). */
export function getParameterNames(type: Class | undefined, method: string): (string | undefined)[] {
  const fn = (type?.prototype as Record<string, unknown> | undefined)?.[method];
  if (typeof fn !== "function") return [];
  const source = Function.prototype.toString.call(fn);
  const start = source.indexOf("(");
  if (start < 0) return [];
  let depth = 0;
  let end = -1;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) return [];
  return splitTopLevel(source.slice(start + 1, end)).map((param) => {
    const name = param.split("=")[0]!.trim();
    return IDENTIFIER.test(name) ? name : undefined;
  });
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim() !== "") parts.push(current);
  return parts;
}
