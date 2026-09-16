import { ILoggerFactory, Transient, createToken, optionsToken, type Guid, type ILogger, type IOptions } from "@abp/core";

/** Port of `AbpSecurityLogOptions`. */
export class AbpSecurityLogOptions {
  isEnabled = true;
  applicationName: string | undefined;
}

/** Port of `SecurityLogInfo`. */
export class SecurityLogInfo {
  applicationName: string | undefined;
  identity: string | undefined;
  action: string | undefined;
  readonly extraProperties = new Map<string, unknown>();
  userId: Guid | undefined;
  userName: string | undefined;
  tenantId: Guid | undefined;
  tenantName: string | undefined;
  clientId: string | undefined;
  correlationId: string | undefined;
  clientIpAddress: string | undefined;
  browserInfo: string | undefined;
  creationTime: Date = new Date();

  toString(): string {
    return `SECURITY LOG: [${this.applicationName ?? ""} - ${this.identity ?? ""} - ${this.action ?? ""}]`;
  }
}

/** Port of `ISecurityLogStore`. */
export interface ISecurityLogStore {
  save(securityLogInfo: SecurityLogInfo): Promise<void>;
}
export const ISecurityLogStore = createToken<ISecurityLogStore>("ISecurityLogStore");

/** Port of `ISecurityLogManager`. */
export interface ISecurityLogManager {
  save(saveAction?: (info: SecurityLogInfo) => void): Promise<void>;
}
export const ISecurityLogManager = createToken<ISecurityLogManager>("ISecurityLogManager");

@Transient(ISecurityLogStore)
export class SimpleSecurityLogStore implements ISecurityLogStore {
  static readonly inject = [ILoggerFactory, optionsToken(AbpSecurityLogOptions)] as const;
  private readonly logger: ILogger;
  protected readonly securityLogOptions: AbpSecurityLogOptions;

  constructor(loggerFactory: ILoggerFactory, securityLogOptions: IOptions<AbpSecurityLogOptions>) {
    this.logger = loggerFactory.createLogger(SimpleSecurityLogStore.name);
    this.securityLogOptions = securityLogOptions.value;
  }

  async save(securityLogInfo: SecurityLogInfo): Promise<void> {
    if (!this.securityLogOptions.isEnabled) return;
    this.logger.info(securityLogInfo.toString());
  }
}

@Transient(ISecurityLogManager)
export class DefaultSecurityLogManager implements ISecurityLogManager {
  static readonly inject = [optionsToken(AbpSecurityLogOptions), ISecurityLogStore] as const;
  protected readonly securityLogOptions: AbpSecurityLogOptions;

  constructor(
    securityLogOptions: IOptions<AbpSecurityLogOptions>,
    protected readonly securityLogStore: ISecurityLogStore,
  ) {
    this.securityLogOptions = securityLogOptions.value;
  }

  async save(saveAction?: (info: SecurityLogInfo) => void): Promise<void> {
    if (!this.securityLogOptions.isEnabled) return;
    const info = await this.create();
    saveAction?.(info);
    await this.securityLogStore.save(info);
  }

  protected async create(): Promise<SecurityLogInfo> {
    const info = new SecurityLogInfo();
    info.applicationName = this.securityLogOptions.applicationName;
    return info;
  }
}
