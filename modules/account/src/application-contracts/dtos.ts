import { IStringLocalizerFactory, type Guid, type ValidationResult } from "@abp/core";
import { IdentityUserConsts } from "@abp/identity/domain-shared";
import { ExtensibleObject } from "@abp/object-extending";
import { createValidationResult, type IValidatableObject, type ValidationContext } from "@abp/validation";
import { z } from "zod";
import { AccountResource, accountEn } from "./localization/account-resource.js";

/** Port of `RegisterDto`. */
export class RegisterDto extends ExtensibleObject {
  static readonly schema = z.object({
    userName: z.string().min(1).max(IdentityUserConsts.maxUserNameLength),
    emailAddress: z.string().min(1).email().max(IdentityUserConsts.maxEmailLength),
    password: z.string().min(1).max(IdentityUserConsts.maxPasswordLength),
    appName: z.string().min(1),
  });
  userName!: string;
  emailAddress!: string;
  password!: string;
  appName!: string;
}

/** Port of `SendPasswordResetCodeDto`. */
export class SendPasswordResetCodeDto {
  static readonly schema = z.object({
    email: z.string().min(1).email().max(IdentityUserConsts.maxEmailLength),
    appName: z.string().min(1),
    returnUrl: z.string().nullish(),
    returnUrlHash: z.string().nullish(),
  });
  email!: string;
  appName!: string;
  returnUrl: string | undefined = undefined;
  returnUrlHash: string | undefined = undefined;
}

/** Port of `VerifyPasswordResetTokenInput`. */
export class VerifyPasswordResetTokenInput {
  static readonly schema = z.object({ userId: z.uuid(), resetToken: z.string().min(1) });
  userId!: Guid;
  resetToken!: string;
}

/** Port of `ResetPasswordDto`. */
export class ResetPasswordDto {
  static readonly schema = z.object({ userId: z.uuid(), resetToken: z.string().min(1), password: z.string().min(1) });
  userId!: Guid;
  resetToken!: string;
  password!: string;
}

/** Port of `ProfileDto`. */
export class ProfileDto extends ExtensibleObject {
  userName!: string;
  email!: string;
  name: string | undefined = undefined;
  surname: string | undefined = undefined;
  phoneNumber: string | undefined = undefined;
  isExternal = false;
  hasPassword = false;
  concurrencyStamp!: string;
}

/** Port of `UpdateProfileDto`. */
export class UpdateProfileDto extends ExtensibleObject {
  static readonly schema = z.object({
    userName: z.string().max(IdentityUserConsts.maxUserNameLength).nullish(),
    email: z.string().max(IdentityUserConsts.maxEmailLength).nullish(),
    name: z.string().max(IdentityUserConsts.maxNameLength).nullish(),
    surname: z.string().max(IdentityUserConsts.maxSurnameLength).nullish(),
    phoneNumber: z.string().max(IdentityUserConsts.maxPhoneNumberLength).nullish(),
    concurrencyStamp: z.string().nullish(),
  });
  userName: string | undefined = undefined;
  email: string | undefined = undefined;
  name: string | undefined = undefined;
  surname: string | undefined = undefined;
  phoneNumber: string | undefined = undefined;
  concurrencyStamp: string | undefined = undefined;
}

/** Port of `ChangePasswordInput` (`IValidatableObject`: the new password must differ from the current one). */
export class ChangePasswordInput implements IValidatableObject {
  static readonly schema = z.object({
    currentPassword: z.string().max(IdentityUserConsts.maxPasswordLength).nullish(),
    newPassword: z.string().min(1).max(IdentityUserConsts.maxPasswordLength),
  });
  currentPassword: string | undefined = undefined;
  newPassword!: string;

  validate(validationContext: ValidationContext): ValidationResult[] {
    if (this.currentPassword !== this.newPassword) return [];
    const localizer = validationContext.getService(IStringLocalizerFactory)?.create(AccountResource);
    const localized = localizer?.get("NewPasswordSameAsOld");
    const message = localized && !localized.resourceNotFound ? localized.value : (accountEn.texts["NewPasswordSameAsOld"] as string);
    return [createValidationResult(message, "currentPassword", "newPassword")];
  }
}
