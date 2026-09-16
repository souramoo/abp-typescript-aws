import { AbpAmbientKeys, IAmbientScopeProvider, ILoggerFactory, IRootServiceProvider, LogLevel, Transient, createToken, forkAmbientScope, optionsToken, type ILogger, type IOptions, type IServiceProvider } from "@abp/core";
import { AbpAuditingOptions, AuditLogContributionContext } from "./abp-auditing-options.js";
import { AuditLogScope, type AuditLogInfo, type IAuditLogSaveHandle, type IAuditLogScope } from "./audit-log-info.js";
import { IAuditingHelper } from "./auditing-helper.js";
import { IAuditingStore } from "./auditing-store.js";
import { EntityChangeType } from "./contracts.js";

/** Port of `IAuditingManager` (+ `runInScope`, a convenience that begins a scope, runs `fn` and saves the log). */
export interface IAuditingManager {
  readonly current: IAuditLogScope | undefined;
  /** Disposable style (`using`): the scope stays current for the rest of the async flow until disposed. */
  beginScope(): IAuditLogSaveHandle;
  /** Callback style: begins a scope around `fn`, records a thrown error and saves the log afterwards. */
  runInScope<R>(fn: (scope: IAuditLogScope) => Promise<R> | R): Promise<R>;
}
export const IAuditingManager = createToken<IAuditingManager>("IAuditingManager");

/** Port of `AuditingManager` on top of `AmbientScopeProvider` (`AbpAmbientKeys.auditLogScope`). */
@Transient(IAuditingManager)
export class AuditingManager implements IAuditingManager {
  static readonly inject = [IAmbientScopeProvider, IAuditingHelper, IAuditingStore, IRootServiceProvider, optionsToken(AbpAuditingOptions), ILoggerFactory] as const;

  protected readonly options: AbpAuditingOptions;
  protected readonly logger: ILogger;

  constructor(
    private readonly ambientScopeProvider: IAmbientScopeProvider<IAuditLogScope>,
    private readonly auditingHelper: IAuditingHelper,
    private readonly auditingStore: IAuditingStore,
    protected readonly serviceProvider: IServiceProvider,
    options: IOptions<AbpAuditingOptions>,
    loggerFactory: ILoggerFactory,
  ) {
    this.options = options.value;
    this.logger = loggerFactory.createLogger(AuditingManager.name);
  }

  get current(): IAuditLogScope | undefined {
    return this.ambientScopeProvider.getValue(AbpAmbientKeys.auditLogScope);
  }

  beginScope(): IAuditLogSaveHandle {
    const scope = new AuditLogScope(this.auditingHelper.createAuditLogInfo());
    const ambientScope = this.ambientScopeProvider.beginScope(AbpAmbientKeys.auditLogScope, scope);
    return new DisposableSaveHandle(this, ambientScope, scope.log, performance.now());
  }

  runInScope<R>(fn: (scope: IAuditLogScope) => Promise<R> | R): Promise<R> {
    return forkAmbientScope(async () => {
      const saveHandle = this.beginScope();
      const scope = this.current!;
      try {
        let result: R;
        try {
          result = await fn(scope);
        } catch (e) {
          if (!scope.log.exceptions.includes(e)) scope.log.exceptions.push(e);
          await this.saveQuietly(saveHandle);
          throw e;
        }
        await this.saveHonouringHideErrors(saveHandle);
        return result;
      } finally {
        saveHandle.dispose();
      }
    });
  }

  protected executePostContributors(auditLogInfo: AuditLogInfo): void {
    const context = new AuditLogContributionContext(this.serviceProvider, auditLogInfo);
    for (const contributor of this.options.contributors) {
      try {
        contributor.postContribute(context);
      } catch (e) {
        this.logger.logException(e, LogLevel.Warning);
      }
    }
  }

  protected beforeSave(saveHandle: DisposableSaveHandle): void {
    saveHandle.auditLog.executionDuration = Math.round(performance.now() - saveHandle.startedAt);
    this.executePostContributors(saveHandle.auditLog);
    this.mergeEntityChanges(saveHandle.auditLog);
  }

  /** Port of `MergeEntityChanges`: several updates of the same entity in one log become one change. */
  protected mergeEntityChanges(auditLog: AuditLogInfo): void {
    const groups = new Map<string, typeof auditLog.entityChanges>();
    for (const change of auditLog.entityChanges) {
      if (change.changeType !== EntityChangeType.Updated) continue;
      const key = `${change.entityTypeFullName ?? ""}|${change.entityId ?? ""}`;
      const group = groups.get(key);
      if (group) group.push(change);
      else groups.set(key, [change]);
    }
    for (const group of groups.values()) {
      if (group.length <= 1) continue;
      const [first, ...rest] = group;
      for (const change of rest) {
        first!.merge(change);
        const index = auditLog.entityChanges.indexOf(change);
        if (index >= 0) auditLog.entityChanges.splice(index, 1);
      }
    }
  }

  /** @internal */
  async _save(saveHandle: DisposableSaveHandle): Promise<void> {
    this.beforeSave(saveHandle);
    await this.auditingStore.save(saveHandle.auditLog);
  }

  private async saveHonouringHideErrors(saveHandle: IAuditLogSaveHandle): Promise<void> {
    try {
      await saveHandle.save();
    } catch (e) {
      if (!this.options.hideErrors) throw e;
      this.logger.logException(e, LogLevel.Error);
    }
  }

  private async saveQuietly(saveHandle: IAuditLogSaveHandle): Promise<void> {
    try {
      await saveHandle.save();
    } catch (e) {
      this.logger.logException(e, LogLevel.Error);
    }
  }
}

/** Port of `AuditingManager.DisposableSaveHandle`. */
export class DisposableSaveHandle implements IAuditLogSaveHandle {
  constructor(
    private readonly auditingManager: AuditingManager,
    private readonly scope: Disposable,
    readonly auditLog: AuditLogInfo,
    readonly startedAt: number,
  ) {}

  save(): Promise<void> {
    return this.auditingManager._save(this);
  }

  dispose(): void {
    this.scope[Symbol.dispose]();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}
