import type { Class, IServiceProvider, IServiceProviderAccessor } from "@abp/core";
import type { AuditLogInfo } from "./audit-log-info.js";

/** Port of `NamedTypeSelector` (from Volo.Abp.Core) as used by `EntityHistorySelectors`. */
export class NamedTypeSelector {
  constructor(
    readonly name: string,
    readonly predicate: (type: Class) => boolean,
  ) {}
}

/** Port of `IEntityHistorySelectorList` / `EntityHistorySelectorList`. */
export class EntityHistorySelectorList extends Array<NamedTypeSelector> {
  add(name: string, predicate: (type: Class) => boolean): this {
    this.push(new NamedTypeSelector(name, predicate));
    return this;
  }

  removeByName(name: string): boolean {
    let removed = false;
    for (let i = this.length - 1; i >= 0; i--) {
      if (this[i]!.name === name) {
        this.splice(i, 1);
        removed = true;
      }
    }
    return removed;
  }
}

/** Port of `AuditLogContributionContext`. */
export class AuditLogContributionContext implements IServiceProviderAccessor {
  constructor(
    readonly serviceProvider: IServiceProvider,
    readonly auditInfo: AuditLogInfo,
  ) {}
}

/** Port of `AuditLogContributor`: `preContribute` runs when the log is created, `postContribute` before it is saved. */
export abstract class AuditLogContributor {
  preContribute(_context: AuditLogContributionContext): void {}
  postContribute(_context: AuditLogContributionContext): void {}
}

/** Port of `AbpAuditingOptions`. */
export class AbpAuditingOptions {
  /** If true, errors while saving an audit log are logged instead of thrown (used by `runInScope` and HTTP hosts). Default: true. */
  hideErrors = true;
  /** Default: true. */
  isEnabled = true;
  /** The name of the application or service writing audit logs. Default: undefined. */
  applicationName: string | undefined = undefined;
  /** Default: true. */
  isEnabledForAnonymousUsers = true;
  /** Audit log on exceptions. Default: true. */
  alwaysLogOnException = true;
  /** Disables/enables audit logging for integration services. Default: false. */
  isEnabledForIntegrationServices = false;
  readonly alwaysLogSelectors: ((auditLogInfo: AuditLogInfo) => Promise<boolean> | boolean)[] = [];
  readonly contributors: AuditLogContributor[] = [];
  /** Argument/entity classes never serialized into audit logs (port default: `AbortSignal`, the `CancellationToken`). */
  readonly ignoredTypes: Class[] = [AbortSignal as unknown as Class];
  readonly entityHistorySelectors = new EntityHistorySelectorList();
  /** Save entity changes to audit log when any navigation property changes. Default: true. */
  saveEntityHistoryWhenNavigationChanges = true;
  /** When false, safe methods (GET, HEAD and QUERY) and `get*` methods are excluded from audit logging. Default: false. */
  isEnabledForGetRequests = false;
  /** Default: false. */
  disableLogActionInfo = false;
}
