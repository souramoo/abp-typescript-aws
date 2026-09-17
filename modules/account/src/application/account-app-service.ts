import { Transient, UserFriendlyException } from "@abp/core";
import { ApplicationService } from "@abp/ddd-application";
import { IdentityUserDto } from "@abp/identity/application-contracts";
import { IdentitySecurityLogActionConsts, IdentitySecurityLogIdentityConsts } from "@abp/identity/domain-shared";
import { IIdentityRoleRepository, IdentitySecurityLogContext, IdentitySecurityLogManager, IdentityUser, IdentityUserManager, UserManagerTokenPurposes } from "@abp/identity/domain";
import { mapExtraPropertiesTo } from "@abp/object-extending";
import { SettingProviderExtensions } from "@abp/settings";
import { AccountResource, AccountSettingNames, IAccountAppService, type RegisterDto, type ResetPasswordDto, type SendPasswordResetCodeDto, type VerifyPasswordResetTokenInput } from "../application-contracts/index.js";
import { IAccountEmailer } from "./account-emailer.js";
import { AbpAccountApplicationModule } from "./abp-account-application-module.js";

/** Port of `AccountAppService`. */
@Transient(IAccountAppService)
export class AccountAppService extends ApplicationService implements IAccountAppService {
  static readonly inject = [IdentityUserManager, IIdentityRoleRepository, IAccountEmailer, IdentitySecurityLogManager] as const;

  constructor(
    protected readonly userManager: IdentityUserManager,
    protected readonly roleRepository: IIdentityRoleRepository,
    protected readonly accountEmailer: IAccountEmailer,
    protected readonly identitySecurityLogManager: IdentitySecurityLogManager,
  ) {
    super();
    this.localizationResource = AccountResource;
    this.objectMapperContext = AbpAccountApplicationModule;
  }

  async register(input: RegisterDto): Promise<IdentityUserDto> {
    await this.checkSelfRegistration();
    const user = new IdentityUser(this.guidGenerator.create(), input.userName, input.emailAddress, this.currentTenant.id);
    mapExtraPropertiesTo(input, user);
    (await this.userManager.create(user, input.password)).checkErrors();
    await this.userManager.setEmail(user, input.emailAddress);
    await this.userManager.addDefaultRoles(user);
    return this.objectMapper.map(IdentityUser, IdentityUserDto, user);
  }

  async sendPasswordResetCode(input: SendPasswordResetCodeDto): Promise<void> {
    const user = await this.getUserByEmail(input.email);
    const resetToken = await this.userManager.generatePasswordResetToken(user);
    await this.accountEmailer.sendPasswordResetLink(user, resetToken, input.appName, input.returnUrl ?? undefined, input.returnUrlHash ?? undefined);
  }

  async verifyPasswordResetToken(input: VerifyPasswordResetTokenInput): Promise<boolean> {
    const user = await this.userManager.getById(input.userId);
    const options = await this.userManager.getOptions();
    return this.userManager.verifyUserToken(user, options.tokens.passwordResetTokenProvider, UserManagerTokenPurposes.ResetPassword, input.resetToken);
  }

  async resetPassword(input: ResetPasswordDto): Promise<void> {
    const user = await this.userManager.getById(input.userId);
    (await this.userManager.resetPassword(user, input.resetToken, input.password)).checkErrors();
    await this.identitySecurityLogManager.save(new IdentitySecurityLogContext({ identity: IdentitySecurityLogIdentityConsts.identity, action: IdentitySecurityLogActionConsts.changePassword }));
  }

  protected async getUserByEmail(email: string): Promise<IdentityUser> {
    const user = await this.userManager.findByEmail(email);
    if (!user) throw new UserFriendlyException(this.L.t("Volo.Account:InvalidEmailAddress", email));
    return user;
  }

  protected async checkSelfRegistration(): Promise<void> {
    if (!(await SettingProviderExtensions.isTrue(this.settingProvider, AccountSettingNames.IsSelfRegistrationEnabled))) {
      throw new UserFriendlyException(this.L.t("SelfRegistrationDisabledMessage"));
    }
  }
}
