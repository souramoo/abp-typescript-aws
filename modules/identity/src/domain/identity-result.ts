import type { ILocalizeErrorMessage, LocalizationContext } from "@abp/http";
import { ArgumentException, BusinessException, Check } from "@abp/core";

/** Port of `Microsoft.AspNetCore.Identity.IdentityError`. */
export interface IdentityError {
  readonly code: string;
  readonly description: string;
}

/** Port of `Microsoft.AspNetCore.Identity.IdentityResult`. */
export class IdentityResult {
  static readonly Success: IdentityResult = new IdentityResult(true, []);

  private constructor(
    readonly succeeded: boolean,
    readonly errors: readonly IdentityError[],
  ) {}

  static failed(...errors: IdentityError[]): IdentityResult {
    return new IdentityResult(false, errors);
  }

  /** Port of `AbpIdentityResultExtensions.CheckErrors`: throws `AbpIdentityResultException` when the result failed. */
  checkErrors(): void {
    if (this.succeeded) return;
    if (!this.errors) throw new ArgumentException("identityResult.Errors should not be null.");
    throw new AbpIdentityResultException(this);
  }

  toString(): string {
    return this.succeeded ? "Succeeded" : `Failed : ${this.errors.map((e) => e.code).join(",")}`;
  }
}

/** Port of `AbpIdentityResultException` (a `BusinessException` + `ILocalizeErrorMessage` whose message lists the error descriptions). */
export class AbpIdentityResultException extends BusinessException implements ILocalizeErrorMessage {
  readonly identityResult: IdentityResult;

  constructor(identityResult: IdentityResult) {
    super({ message: identityResult.errors.map((err) => err.description).join(", ") });
    this.identityResult = Check.notNull(identityResult, "identityResult");
  }

  localizeMessage(_context: LocalizationContext): string {
    return this.message;
  }
}

/** Port of `AbpIdentityResultExtensions.CheckErrors` as a free function. */
export function checkErrors(identityResult: IdentityResult): void {
  identityResult.checkErrors();
}

/** Port of `Microsoft.AspNetCore.Identity.SignInResult` as a discriminated value. */
export class SignInResult {
  static readonly Success = new SignInResult(true, false, false, false);
  static readonly Failed = new SignInResult(false, false, false, false);
  static readonly LockedOut = new SignInResult(false, true, false, false);
  static readonly NotAllowed = new SignInResult(false, false, true, false);
  static readonly TwoFactorRequired = new SignInResult(false, false, false, true);

  private constructor(
    readonly succeeded: boolean,
    readonly isLockedOut: boolean,
    readonly isNotAllowed: boolean,
    readonly requiresTwoFactor: boolean,
  ) {}

  /** Port of `AbpIdentityResultExtensions.GetResultAsString`. */
  toString(): string {
    if (this.succeeded) return "Succeeded";
    if (this.isLockedOut) return "IsLockedOut";
    if (this.isNotAllowed) return "IsNotAllowed";
    if (this.requiresTwoFactor) return "RequiresTwoFactor";
    return "Unknown";
  }
}
