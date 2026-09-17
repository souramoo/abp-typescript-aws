import { createToken } from "@abp/core";
import type { IApplicationService } from "@abp/ddd-application";
import type { IdentityUserDto } from "@abp/identity/application-contracts";
import type { ChangePasswordInput, ProfileDto, RegisterDto, ResetPasswordDto, SendPasswordResetCodeDto, UpdateProfileDto, VerifyPasswordResetTokenInput } from "./dtos.js";

/** Port of `AccountRemoteServiceConsts`. */
export const AccountRemoteServiceConsts = {
  RemoteServiceName: "AbpAccount",
  ModuleName: "account",
} as const;

/** Port of `AccountSettingNames`. */
export const AccountSettingNames = {
  IsSelfRegistrationEnabled: "Abp.Account.IsSelfRegistrationEnabled",
  EnableLocalLogin: "Abp.Account.EnableLocalLogin",
} as const;

/** Port of `IAccountAppService`. */
export interface IAccountAppService extends IApplicationService {
  register(input: RegisterDto): Promise<IdentityUserDto>;
  sendPasswordResetCode(input: SendPasswordResetCodeDto): Promise<void>;
  verifyPasswordResetToken(input: VerifyPasswordResetTokenInput): Promise<boolean>;
  resetPassword(input: ResetPasswordDto): Promise<void>;
}
export const IAccountAppService = createToken<IAccountAppService>("IAccountAppService");

/** Port of `IProfileAppService`. */
export interface IProfileAppService extends IApplicationService {
  get(): Promise<ProfileDto>;
  update(input: UpdateProfileDto): Promise<ProfileDto>;
  changePassword(input: ChangePasswordInput): Promise<void>;
}
export const IProfileAppService = createToken<IProfileAppService>("IProfileAppService");

/** Port of `IDynamicClaimsAppService`. */
export interface IDynamicClaimsAppService extends IApplicationService {
  refresh(): Promise<void>;
}
export const IDynamicClaimsAppService = createToken<IDynamicClaimsAppService>("IDynamicClaimsAppService");
