import { Dependency, ILoggerFactory, Transient, isNullOrWhiteSpace, optionsToken, type ILogger, type IOptions } from "@abp/core";
import { IGuidGenerator } from "@abp/guids";
import { AbpSecurityLogOptions, ICurrentPrincipalAccessor, ICurrentUser, ISecurityLogManager, ISecurityLogStore, type SecurityLogInfo } from "@abp/security";
import { IUnitOfWorkManager } from "@abp/uow";
import { AbpUserClaimsPrincipalFactory } from "./abp-user-claims-principal-factory.js";
import { IdentitySecurityLog } from "./identity-security-log.js";
import { IdentityUserManager } from "./identity-user-manager.js";
import { IIdentitySecurityLogRepository } from "./repositories.js";

/** Port of `IdentitySecurityLogContext`. */
export class IdentitySecurityLogContext {
  identity: string | undefined;
  action: string | undefined;
  userName: string | undefined;
  clientId: string | undefined;
  readonly extraProperties = new Map<string, unknown>();

  constructor(init: { identity?: string; action?: string; userName?: string; clientId?: string } = {}) {
    this.identity = init.identity;
    this.action = init.action;
    this.userName = init.userName;
    this.clientId = init.clientId;
  }

  withProperty(key: string, value: unknown): this {
    this.extraProperties.set(key, value);
    return this;
  }
}

/** Port of `IdentitySecurityLogManager`: saves a security log for the current user, or for `context.userName` when nobody is signed in. */
@Transient()
export class IdentitySecurityLogManager {
  static readonly inject = [ISecurityLogManager, IdentityUserManager, ICurrentPrincipalAccessor, AbpUserClaimsPrincipalFactory, ICurrentUser] as const;

  constructor(
    protected readonly securityLogManager: ISecurityLogManager,
    protected readonly userManager: IdentityUserManager,
    protected readonly currentPrincipalAccessor: ICurrentPrincipalAccessor,
    protected readonly userClaimsPrincipalFactory: AbpUserClaimsPrincipalFactory,
    protected readonly currentUser: ICurrentUser,
  ) {}

  async save(context: IdentitySecurityLogContext): Promise<void> {
    const securityLogAction = (securityLog: SecurityLogInfo): void => {
      securityLog.identity = context.identity;
      securityLog.action = context.action;
      if (!isNullOrWhiteSpace(context.userName)) securityLog.userName = context.userName;
      if (!isNullOrWhiteSpace(context.clientId)) securityLog.clientId = context.clientId;
      for (const [key, value] of context.extraProperties) securityLog.extraProperties.set(key, value);
    };

    if (this.currentUser.isAuthenticated || isNullOrWhiteSpace(context.userName)) {
      await this.securityLogManager.save(securityLogAction);
      return;
    }
    const user = await this.userManager.findByName(context.userName);
    if (!user) {
      await this.securityLogManager.save(securityLogAction);
      return;
    }
    const principal = await this.userClaimsPrincipalFactory.create(user);
    await this.currentPrincipalAccessor.run(principal, () => this.securityLogManager.save(securityLogAction));
  }
}

/** Port of `IdentitySecurityLogStore`: persists security logs as `IdentitySecurityLog` entities in their own unit of work. */
@Dependency({ replaceServices: true })
@Transient(ISecurityLogStore)
export class IdentitySecurityLogStore implements ISecurityLogStore {
  static readonly inject = [ILoggerFactory, optionsToken(AbpSecurityLogOptions), IIdentitySecurityLogRepository, IGuidGenerator, IUnitOfWorkManager] as const;
  protected readonly logger: ILogger;
  protected readonly securityLogOptions: AbpSecurityLogOptions;

  constructor(
    loggerFactory: ILoggerFactory,
    securityLogOptions: IOptions<AbpSecurityLogOptions>,
    protected readonly identitySecurityLogRepository: IIdentitySecurityLogRepository,
    protected readonly guidGenerator: IGuidGenerator,
    protected readonly unitOfWorkManager: IUnitOfWorkManager,
  ) {
    this.logger = loggerFactory.createLogger(IdentitySecurityLogStore.name);
    this.securityLogOptions = securityLogOptions.value;
  }

  async save(securityLogInfo: SecurityLogInfo): Promise<void> {
    if (!this.securityLogOptions.isEnabled) return;
    const uow = this.unitOfWorkManager.begin(undefined, true);
    try {
      await this.identitySecurityLogRepository.insert(new IdentitySecurityLog(this.guidGenerator, securityLogInfo));
      await uow.complete();
    } finally {
      await uow.dispose();
    }
  }
}
