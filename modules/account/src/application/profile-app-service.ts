import { BusinessException, Transient, isNullOrEmptyString, isNullOrWhiteSpace } from "@abp/core";
import { Authorize } from "@abp/authorization";
import { setConcurrencyStampIfNotNull } from "@abp/data";
import { IdentityAppServiceBase } from "@abp/identity/application";
import { IdentityErrorCodes, IdentitySettingNames } from "@abp/identity/domain-shared";
import { IdentityUser, IdentityUserManager } from "@abp/identity/domain";
import { mapExtraPropertiesTo } from "@abp/object-extending";
import { getId } from "@abp/security";
import { SettingProviderExtensions } from "@abp/settings";
import { IProfileAppService, ProfileDto, type ChangePasswordInput, type UpdateProfileDto } from "../application-contracts/index.js";
import { AbpAccountApplicationModule } from "./abp-account-application-module.js";

/** Port of `ProfileAppService`. */
@Transient(IProfileAppService)
@Authorize()
export class ProfileAppService extends IdentityAppServiceBase implements IProfileAppService {
  static readonly inject = [IdentityUserManager] as const;

  constructor(protected readonly userManager: IdentityUserManager) {
    super();
    this.objectMapperContext = AbpAccountApplicationModule;
  }

  async get(): Promise<ProfileDto> {
    const currentUser = await this.userManager.getById(getId(this.currentUser));
    return this.objectMapper.map(IdentityUser, ProfileDto, currentUser);
  }

  async update(input: UpdateProfileDto): Promise<ProfileDto> {
    const user = await this.userManager.getById(getId(this.currentUser));
    setConcurrencyStampIfNotNull(user, input.concurrencyStamp);

    if (input.userName !== undefined && input.userName !== null && user.userName.toLowerCase() !== input.userName.toLowerCase()) {
      if (await SettingProviderExtensions.isTrue(this.settingProvider, IdentitySettingNames.User.IsUserNameUpdateEnabled)) (await this.userManager.setUserName(user, input.userName)).checkErrors();
    }
    if (input.email !== undefined && input.email !== null && user.email.toLowerCase() !== input.email.toLowerCase()) {
      if (await SettingProviderExtensions.isTrue(this.settingProvider, IdentitySettingNames.User.IsEmailUpdateEnabled)) (await this.userManager.setEmail(user, input.email)).checkErrors();
    }
    if (isNullOrWhiteSpace(user.phoneNumber) && isNullOrWhiteSpace(input.phoneNumber)) input.phoneNumber = user.phoneNumber;
    if ((user.phoneNumber ?? "").toLowerCase() !== (input.phoneNumber ?? "").toLowerCase()) (await this.userManager.setPhoneNumber(user, input.phoneNumber ?? undefined)).checkErrors();

    user.name = input.name?.trim();
    user.surname = input.surname?.trim();
    mapExtraPropertiesTo(input, user);
    (await this.userManager.update(user)).checkErrors();
    await this.currentUnitOfWork?.saveChanges();
    return this.objectMapper.map(IdentityUser, ProfileDto, user);
  }

  async changePassword(input: ChangePasswordInput): Promise<void> {
    const currentUser = await this.userManager.getById(getId(this.currentUser));
    if (currentUser.isExternal) throw new BusinessException({ code: IdentityErrorCodes.ExternalUserPasswordChange });
    if (isNullOrEmptyString(currentUser.passwordHash)) {
      (await this.userManager.addPassword(currentUser, input.newPassword)).checkErrors();
      return;
    }
    (await this.userManager.changePassword(currentUser, input.currentPassword ?? "", input.newPassword)).checkErrors();
  }
}
