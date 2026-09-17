import { AbpException, Check, isNullOrWhiteSpace, type ServiceKey } from "@abp/core";
import { IGuidGenerator } from "@abp/guids";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { IdentityUser, UserLoginInfo } from "./identity-user.js";
import { IdentityUserManager } from "./identity-user-manager.js";
import { IIdentityUserRepository } from "./repositories.js";

/** Port of `IExternalLoginProvider`: an external system that authenticates user names/passwords (LDAP, …). */
export interface IExternalLoginProvider {
  tryAuthenticate(userName: string, plainPassword: string): Promise<boolean>;
  createUser(userName: string, providerName: string): Promise<IdentityUser>;
  updateUser(user: IdentityUser, providerName: string): Promise<void>;
  isEnabled(): Promise<boolean>;
}

/** Port of `IExternalLoginProviderWithPassword`. */
export interface IExternalLoginProviderWithPassword {
  readonly canObtainUserInfoWithoutPassword: boolean;
  createUserWithPassword(userName: string, providerName: string, plainPassword: string): Promise<IdentityUser>;
  updateUserWithPassword(user: IdentityUser, providerName: string, plainPassword: string): Promise<void>;
}

export function isExternalLoginProviderWithPassword(provider: IExternalLoginProvider): provider is IExternalLoginProvider & IExternalLoginProviderWithPassword {
  return typeof (provider as Partial<IExternalLoginProviderWithPassword>).createUserWithPassword === "function";
}

/** Port of `ExternalLoginUserInfo`. */
export class ExternalLoginUserInfo {
  readonly email: string;
  name: string | undefined;
  surname: string | undefined;
  phoneNumber: string | undefined;
  phoneNumberConfirmed: boolean | undefined;
  emailConfirmed: boolean | undefined;
  twoFactorEnabled: boolean | undefined;
  providerKey: string | undefined;

  constructor(email: string) {
    this.email = Check.notNullOrWhiteSpace(email, "email");
  }
}

/** Port of `ExternalLoginProviderBase`. Concrete providers need their own `@Transient()`. */
export abstract class ExternalLoginProviderBase implements IExternalLoginProvider {
  static readonly inject: readonly ServiceKey[] = [IGuidGenerator, ICurrentTenant, IdentityUserManager, IIdentityUserRepository];

  protected constructor(
    protected readonly guidGenerator: IGuidGenerator,
    protected readonly currentTenant: ICurrentTenant,
    protected readonly userManager: IdentityUserManager,
    protected readonly identityUserRepository: IIdentityUserRepository,
  ) {}

  abstract tryAuthenticate(userName: string, plainPassword: string): Promise<boolean>;
  abstract isEnabled(): Promise<boolean>;

  async createUser(userName: string, providerName: string): Promise<IdentityUser> {
    const externalUser = await this.getUserInfo(userName);
    return this.createUserFrom(externalUser, userName, providerName);
  }

  protected async createUserFrom(externalUser: ExternalLoginUserInfo, userName: string, providerName: string): Promise<IdentityUser> {
    normalizeExternalLoginUserInfo(externalUser, userName);
    const user = new IdentityUser(this.guidGenerator.create(), userName, externalUser.email, this.currentTenant.id);
    user.name = externalUser.name;
    user.surname = externalUser.surname;
    user.isExternal = true;
    user.setEmailConfirmed(externalUser.emailConfirmed ?? false);
    user.setPhoneNumber(externalUser.phoneNumber, externalUser.phoneNumberConfirmed ?? false);
    (await this.userManager.create(user)).checkErrors();
    if (externalUser.twoFactorEnabled !== undefined) (await this.userManager.setTwoFactorEnabled(user, externalUser.twoFactorEnabled)).checkErrors();
    (await this.userManager.addDefaultRoles(user)).checkErrors();
    (await this.userManager.addLogin(user, new UserLoginInfo(providerName, externalUser.providerKey!, providerName))).checkErrors();
    return user;
  }

  async updateUser(user: IdentityUser, providerName: string): Promise<void> {
    const externalUser = await this.getUserInfoOf(user);
    await this.updateUserFrom(user, externalUser, providerName);
  }

  protected async updateUserFrom(user: IdentityUser, externalUser: ExternalLoginUserInfo, providerName: string): Promise<void> {
    normalizeExternalLoginUserInfo(externalUser, user.userName);
    if (!isNullOrWhiteSpace(externalUser.name)) user.name = externalUser.name;
    if (!isNullOrWhiteSpace(externalUser.surname)) user.surname = externalUser.surname;
    if (user.phoneNumber !== externalUser.phoneNumber) {
      if (!isNullOrWhiteSpace(externalUser.phoneNumber)) {
        await this.userManager.setPhoneNumber(user, externalUser.phoneNumber);
        user.setPhoneNumberConfirmed(externalUser.phoneNumberConfirmed === true);
      }
    } else if (!isNullOrWhiteSpace(user.phoneNumber) && !user.phoneNumberConfirmed && externalUser.phoneNumberConfirmed === true) {
      user.setPhoneNumberConfirmed(true);
    }
    if (user.email.toLowerCase() !== externalUser.email.toLowerCase()) {
      (await this.userManager.setEmail(user, externalUser.email)).checkErrors();
      user.setEmailConfirmed(externalUser.emailConfirmed ?? false);
    }
    if (externalUser.twoFactorEnabled !== undefined) (await this.userManager.setTwoFactorEnabled(user, externalUser.twoFactorEnabled)).checkErrors();

    const userLogin = user.logins.find((l) => l.loginProvider === providerName);
    if (userLogin) {
      if (userLogin.providerKey !== externalUser.providerKey) {
        (await this.userManager.removeLogin(user, providerName, userLogin.providerKey)).checkErrors();
        (await this.userManager.addLogin(user, new UserLoginInfo(providerName, externalUser.providerKey!, providerName))).checkErrors();
      }
    } else {
      (await this.userManager.addLogin(user, new UserLoginInfo(providerName, externalUser.providerKey!, providerName))).checkErrors();
    }
    user.isExternal = true;
    (await this.userManager.update(user)).checkErrors();
  }

  protected abstract getUserInfo(userName: string): Promise<ExternalLoginUserInfo>;

  protected getUserInfoOf(user: IdentityUser): Promise<ExternalLoginUserInfo> {
    return this.getUserInfo(user.userName);
  }
}

/** Port of `ExternalLoginProviderWithPasswordBase`. */
export abstract class ExternalLoginProviderWithPasswordBase extends ExternalLoginProviderBase implements IExternalLoginProviderWithPassword {
  protected constructor(guidGenerator: IGuidGenerator, currentTenant: ICurrentTenant, userManager: IdentityUserManager, identityUserRepository: IIdentityUserRepository, readonly canObtainUserInfoWithoutPassword = false) {
    super(guidGenerator, currentTenant, userManager, identityUserRepository);
  }

  async createUserWithPassword(userName: string, providerName: string, plainPassword: string): Promise<IdentityUser> {
    if (this.canObtainUserInfoWithoutPassword) return this.createUser(userName, providerName);
    return this.createUserFrom(await this.getUserInfoWithPassword(userName, plainPassword), userName, providerName);
  }

  async updateUserWithPassword(user: IdentityUser, providerName: string, plainPassword: string): Promise<void> {
    if (this.canObtainUserInfoWithoutPassword) {
      await this.updateUser(user, providerName);
      return;
    }
    await this.updateUserFrom(user, await this.getUserInfoWithPassword(user.userName, plainPassword), providerName);
  }

  protected override getUserInfo(_userName: string): Promise<ExternalLoginUserInfo> {
    throw new AbpException("getUserInfo is not implemented by default. It should be overridden and implemented by the deriving class!");
  }

  protected abstract getUserInfoWithPassword(userName: string, plainPassword: string): Promise<ExternalLoginUserInfo>;
}

function normalizeExternalLoginUserInfo(externalUser: ExternalLoginUserInfo, userName: string): void {
  if (isNullOrWhiteSpace(externalUser.providerKey)) externalUser.providerKey = userName;
}
