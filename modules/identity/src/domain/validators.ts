import { Check, Transient, createToken, isNullOrWhiteSpace } from "@abp/core";
import { ValidationHelper } from "@abp/validation";
import type { AbpIdentityErrorDescriber } from "./abp-identity-error-describer.js";
import type { IdentityOptions } from "./identity-options.js";
import { IdentityResult, type IdentityError } from "./identity-result.js";
import type { IdentityRole } from "./identity-role.js";
import type { IdentityUser } from "./identity-user.js";

/** What the validators need from the manager (`UserManager<IdentityUser>` in .NET). */
export interface IUserManagerForValidation {
  readonly errorDescriber: AbpIdentityErrorDescriber;
  readonly options: IdentityOptions;
  findByName(userName: string): Promise<IdentityUser | undefined>;
  findByEmail(email: string): Promise<IdentityUser | undefined>;
}

/** Port of `IUserValidator<IdentityUser>`. Implementations register with `@Transient(IUserValidator)`; all registrations run. */
export interface IUserValidator {
  validate(manager: IUserManagerForValidation, user: IdentityUser): Promise<IdentityResult>;
}
export const IUserValidator = createToken<IUserValidator>("IUserValidator");

/** Port of `IPasswordValidator<IdentityUser>`. */
export interface IPasswordValidator {
  validate(manager: IUserManagerForValidation, user: IdentityUser, password: string | undefined): Promise<IdentityResult>;
}
export const IPasswordValidator = createToken<IPasswordValidator>("IPasswordValidator");

/** What `IRoleValidator` needs from `RoleManager<IdentityRole>`. */
export interface IRoleManagerForValidation {
  readonly errorDescriber: AbpIdentityErrorDescriber;
  findByName(roleName: string): Promise<IdentityRole | undefined>;
}

/** Port of `IRoleValidator<IdentityRole>`. */
export interface IRoleValidator {
  validate(manager: IRoleManagerForValidation, role: IdentityRole): Promise<IdentityResult>;
}
export const IRoleValidator = createToken<IRoleValidator>("IRoleValidator");

/** Port of `UserValidator<TUser>`: allowed user-name characters, unique user name and (optionally) unique email. */
export class UserValidator implements IUserValidator {
  async validate(manager: IUserManagerForValidation, user: IdentityUser): Promise<IdentityResult> {
    Check.notNull(manager, "manager");
    Check.notNull(user, "user");
    const errors: IdentityError[] = [];
    await this.validateUserName(manager, user, errors);
    if (manager.options.user.requireUniqueEmail) await this.validateEmail(manager, user, errors);
    return errors.length > 0 ? IdentityResult.failed(...errors) : IdentityResult.Success;
  }

  protected async validateUserName(manager: IUserManagerForValidation, user: IdentityUser, errors: IdentityError[]): Promise<void> {
    const userName = user.userName;
    if (isNullOrWhiteSpace(userName)) {
      errors.push(manager.errorDescriber.invalidUserName(userName));
      return;
    }
    const allowed = manager.options.user.allowedUserNameCharacters;
    if (!isNullOrWhiteSpace(allowed) && [...userName].some((c) => !allowed.includes(c))) {
      errors.push(manager.errorDescriber.invalidUserName(userName));
      return;
    }
    const owner = await manager.findByName(userName);
    if (owner !== undefined && owner.id !== user.id) errors.push(manager.errorDescriber.duplicateUserName(userName));
  }

  protected async validateEmail(manager: IUserManagerForValidation, user: IdentityUser, errors: IdentityError[]): Promise<void> {
    const email = user.email;
    if (isNullOrWhiteSpace(email)) {
      errors.push(manager.errorDescriber.invalidEmail(email));
      return;
    }
    if (!ValidationHelper.isValidEmailAddress(email)) {
      errors.push(manager.errorDescriber.invalidEmail(email));
      return;
    }
    const owner = await manager.findByEmail(email);
    if (owner !== undefined && owner.id !== user.id) errors.push(manager.errorDescriber.duplicateEmail(email));
  }
}

/**
 * Port of `AbpIdentityUserValidator` for the `Isolated` user-sharing strategy: the default validation plus
 * "user name must not be another user's email" and "email must not be another user's user name". The `Shared`
 * strategy (cross-tenant uniqueness under a distributed lock) is not ported; it behaves like `Isolated`.
 */
@Transient(IUserValidator)
export class AbpIdentityUserValidator implements IUserValidator {
  protected readonly defaultUserValidator = new UserValidator();

  async validate(manager: IUserManagerForValidation, user: IdentityUser): Promise<IdentityResult> {
    Check.notNull(manager, "manager");
    Check.notNull(user, "user");
    const defaultValidationResult = await this.defaultUserValidator.validate(manager, user);
    if (!defaultValidationResult.succeeded) return defaultValidationResult;

    const errors: IdentityError[] = [];
    const userName = user.userName;
    if (userName === undefined || userName === null) {
      errors.push(manager.errorDescriber.invalidUserName(undefined));
    } else {
      const owner = await manager.findByEmail(userName);
      if (owner !== undefined && owner.id !== user.id) errors.push(manager.errorDescriber.invalidUserName(userName));
    }
    const email = user.email;
    if (email === undefined || email === null) {
      errors.push(manager.errorDescriber.invalidEmail(undefined));
    } else {
      const owner = await manager.findByName(email);
      if (owner !== undefined && owner.id !== user.id) errors.push(manager.errorDescriber.invalidEmail(email));
    }
    return errors.length > 0 ? IdentityResult.failed(...errors) : IdentityResult.Success;
  }
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}
function isLower(c: string): boolean {
  return c >= "a" && c <= "z";
}
function isUpper(c: string): boolean {
  return c >= "A" && c <= "Z";
}
function isLetterOrDigit(c: string): boolean {
  return isDigit(c) || isLower(c) || isUpper(c);
}

/** Port of `PasswordValidator<TUser>`: applies `IdentityOptions.password`. */
@Transient(IPasswordValidator)
export class PasswordValidator implements IPasswordValidator {
  async validate(manager: IUserManagerForValidation, _user: IdentityUser, password: string | undefined): Promise<IdentityResult> {
    Check.notNull(manager, "manager");
    const errors: IdentityError[] = [];
    const options = manager.options.password;
    const describer = manager.errorDescriber;
    if (isNullOrWhiteSpace(password) || password.length < options.requiredLength) errors.push(describer.passwordTooShort(options.requiredLength));
    const text = password ?? "";
    if (options.requireNonAlphanumeric && [...text].every(isLetterOrDigit)) errors.push(describer.passwordRequiresNonAlphanumeric());
    if (options.requireDigit && ![...text].some(isDigit)) errors.push(describer.passwordRequiresDigit());
    if (options.requireLowercase && ![...text].some(isLower)) errors.push(describer.passwordRequiresLower());
    if (options.requireUppercase && ![...text].some(isUpper)) errors.push(describer.passwordRequiresUpper());
    if (options.requiredUniqueChars >= 1 && new Set(text).size < options.requiredUniqueChars) errors.push(describer.passwordRequiresUniqueChars(options.requiredUniqueChars));
    return errors.length > 0 ? IdentityResult.failed(...errors) : IdentityResult.Success;
  }
}

/** Port of `RoleValidator<TRole>`: a non-empty, unique role name. */
@Transient(IRoleValidator)
export class RoleValidator implements IRoleValidator {
  async validate(manager: IRoleManagerForValidation, role: IdentityRole): Promise<IdentityResult> {
    Check.notNull(manager, "manager");
    Check.notNull(role, "role");
    const roleName = role.name;
    if (isNullOrWhiteSpace(roleName)) return IdentityResult.failed(manager.errorDescriber.invalidRoleName(roleName));
    const owner = await manager.findByName(roleName);
    if (owner !== undefined && owner.id !== role.id) return IdentityResult.failed(manager.errorDescriber.duplicateRoleName(roleName));
    return IdentityResult.Success;
  }
}
