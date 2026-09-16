import { Dependency, ILoggerFactory, Singleton, createToken, type ILogger } from "@abp/core";
import type { AuditLogInfo } from "./audit-log-info.js";

/** Port of `IAuditingStore`. */
export interface IAuditingStore {
  save(auditInfo: AuditLogInfo): Promise<void>;
}
export const IAuditingStore = createToken<IAuditingStore>("IAuditingStore");

/** Port of `SimpleLogAuditingStore`: the default store, writes the log through `ILoggerFactory`. */
@Dependency({ tryRegister: true })
@Singleton(IAuditingStore)
export class SimpleLogAuditingStore implements IAuditingStore {
  static readonly inject = [ILoggerFactory] as const;
  protected readonly logger: ILogger;

  constructor(loggerFactory: ILoggerFactory) {
    this.logger = loggerFactory.createLogger(SimpleLogAuditingStore.name);
  }

  async save(auditInfo: AuditLogInfo): Promise<void> {
    this.logger.info(auditInfo.toString());
  }
}
