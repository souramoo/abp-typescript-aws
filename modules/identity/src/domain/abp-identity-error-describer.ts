import { IStringLocalizerFactory, Transient, type IStringLocalizer } from "@abp/core";
import { IdentityResource } from "../domain-shared/index.js";
import type { IdentityError } from "./identity-result.js";

/**
 * Port of `IdentityErrorDescriber` + `AbpIdentityErrorDescriber`: the error codes of ASP.NET Core Identity with
 * descriptions from the `AbpIdentity` resource (`Volo.Abp.Identity:<Code>`).
 */
@Transient()
export class AbpIdentityErrorDescriber {
  static readonly inject = [IStringLocalizerFactory] as const;
  protected readonly localizer: IStringLocalizer;

  constructor(stringLocalizerFactory: IStringLocalizerFactory) {
    this.localizer = stringLocalizerFactory.create(IdentityResource);
  }

  protected error(code: string, ...args: unknown[]): IdentityError {
    return { code, description: this.localizer.t(`Volo.Abp.Identity:${code}`, ...args) };
  }

  defaultError(): IdentityError {
    return this.error("DefaultError");
  }
  concurrencyFailure(): IdentityError {
    return this.error("ConcurrencyFailure");
  }
  passwordMismatch(): IdentityError {
    return this.error("PasswordMismatch");
  }
  invalidToken(): IdentityError {
    return this.error("InvalidToken");
  }
  recoveryCodeRedemptionFailed(): IdentityError {
    return this.error("RecoveryCodeRedemptionFailed");
  }
  loginAlreadyAssociated(): IdentityError {
    return this.error("LoginAlreadyAssociated");
  }
  invalidUserName(userName: string | undefined): IdentityError {
    return this.error("InvalidUserName", userName ?? "");
  }
  invalidEmail(email: string | undefined): IdentityError {
    return this.error("InvalidEmail", email ?? "");
  }
  duplicateUserName(userName: string): IdentityError {
    return this.error("DuplicateUserName", userName);
  }
  duplicateEmail(email: string): IdentityError {
    return this.error("DuplicateEmail", email);
  }
  invalidRoleName(role: string | undefined): IdentityError {
    return this.error("InvalidRoleName", role ?? "");
  }
  duplicateRoleName(role: string): IdentityError {
    return this.error("DuplicateRoleName", role);
  }
  userAlreadyHasPassword(): IdentityError {
    return this.error("UserAlreadyHasPassword");
  }
  userLockoutNotEnabled(): IdentityError {
    return this.error("UserLockoutNotEnabled");
  }
  userAlreadyInRole(role: string): IdentityError {
    return this.error("UserAlreadyInRole", role);
  }
  userNotInRole(role: string): IdentityError {
    return this.error("UserNotInRole", role);
  }
  passwordTooShort(length: number): IdentityError {
    return this.error("PasswordTooShort", length);
  }
  passwordRequiresUniqueChars(uniqueChars: number): IdentityError {
    return this.error("PasswordRequiresUniqueChars", uniqueChars);
  }
  passwordRequiresNonAlphanumeric(): IdentityError {
    return this.error("PasswordRequiresNonAlphanumeric");
  }
  passwordRequiresDigit(): IdentityError {
    return this.error("PasswordRequiresDigit");
  }
  passwordRequiresLower(): IdentityError {
    return this.error("PasswordRequiresLower");
  }
  passwordRequiresUpper(): IdentityError {
    return this.error("PasswordRequiresUpper");
  }
  userLockedOut(): IdentityError {
    return this.error("UserLockedOut");
  }
  userNameNotFound(userName: string): IdentityError {
    return this.error("UserNameNotFound", userName);
  }
  roleNotFound(role: string): IdentityError {
    return this.error("RoleNotFound", role);
  }
}
