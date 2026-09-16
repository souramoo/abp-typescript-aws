import { Dependency, ILoggerFactory, LogLevel, Transient, optionsToken, type ILogger, type IOptions } from "@abp/core";
import { AbpAuditingOptions, IAuditingStore, type AuditLogInfo } from "@abp/auditing";
import { IUnitOfWorkManager } from "@abp/uow";
import { IAuditLogInfoToAuditLogConverter } from "./audit-log-info-to-audit-log-converter.js";
import { IAuditLogRepository } from "./audit-log-repository.js";

/** Port of `AuditingStore`: replaces `SimpleLogAuditingStore`, saving each log in its own (new) unit of work. */
@Dependency({ replaceServices: true })
@Transient(IAuditingStore)
export class AuditingStore implements IAuditingStore {
  static readonly inject = [IAuditLogRepository, IUnitOfWorkManager, optionsToken(AbpAuditingOptions), IAuditLogInfoToAuditLogConverter, ILoggerFactory] as const;
  protected readonly options: AbpAuditingOptions;
  protected readonly logger: ILogger;

  constructor(
    protected readonly auditLogRepository: IAuditLogRepository,
    protected readonly unitOfWorkManager: IUnitOfWorkManager,
    options: IOptions<AbpAuditingOptions>,
    protected readonly converter: IAuditLogInfoToAuditLogConverter,
    loggerFactory: ILoggerFactory,
  ) {
    this.options = options.value;
    this.logger = loggerFactory.createLogger(AuditingStore.name);
  }

  async save(auditInfo: AuditLogInfo): Promise<void> {
    if (!this.options.hideErrors) {
      await this.saveLog(auditInfo);
      return;
    }

    try {
      await this.saveLog(auditInfo);
    } catch (e) {
      this.logger.warn("Could not save the audit log object: \n" + auditInfo.toString());
      this.logger.logException(e, LogLevel.Error);
    }
  }

  protected async saveLog(auditInfo: AuditLogInfo): Promise<void> {
    const uow = this.unitOfWorkManager.begin(undefined, true);
    try {
      await this.auditLogRepository.insert(await this.converter.convert(auditInfo));
      await uow.complete();
    } finally {
      await uow.dispose();
    }
  }
}
