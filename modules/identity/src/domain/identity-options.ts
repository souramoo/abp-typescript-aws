import { Check, Scoped, Transient, createToken, optionsToken, type Class, type IOptions } from "@abp/core";
import { ISettingProvider, SettingProviderExtensions } from "@abp/settings";
import { IdentitySettingNames, LinkUserTokenProviderConsts } from "../domain-shared/index.js";
import type { IExternalLoginProvider } from "./external-login-provider.js";
import type { IIdentityTokenProvider } from "./token-providers.js";

/** Port of `Microsoft.AspNetCore.Identity.PasswordOptions`. */
export class PasswordOptions {
  requiredLength = 6;
  requiredUniqueChars = 1;
  requireNonAlphanumeric = true;
  requireLowercase = true;
  requireUppercase = true;
  requireDigit = true;
}

/** Port of `LockoutOptions` (`DefaultLockoutTimeSpan` in milliseconds). */
export class LockoutOptions {
  allowedForNewUsers = true;
  maxFailedAccessAttempts = 5;
  defaultLockoutTimeSpanMs = 5 * 60 * 1000;
}

/** Port of `UserOptions`. */
export class UserOptions {
  allowedUserNameCharacters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._@+";
  requireUniqueEmail = false;
}

/** Port of `SignInOptions`. */
export class SignInOptions {
  requireConfirmedEmail = false;
  requireConfirmedPhoneNumber = false;
  requireConfirmedAccount = false;
}

/** Port of `TokenOptions` (provider names of the built-in token purposes). */
export class TokenOptions {
  static readonly DefaultProvider = "Default";
  static readonly DefaultEmailProvider = "Email";
  static readonly DefaultPhoneProvider = "Phone";
  static readonly DefaultAuthenticatorProvider = "Authenticator";

  emailConfirmationTokenProvider: string = TokenOptions.DefaultProvider;
  passwordResetTokenProvider: string = TokenOptions.DefaultProvider;
  changeEmailTokenProvider: string = TokenOptions.DefaultProvider;
  changePhoneNumberTokenProvider: string = TokenOptions.DefaultPhoneProvider;
  authenticatorTokenProvider: string = TokenOptions.DefaultAuthenticatorProvider;
  authenticatorIssuer = "Microsoft.AspNetCore.Identity.UI";
  /** Port of `ProviderMap`: provider name → the `IIdentityTokenProvider` class resolved from the container. */
  readonly providerMap = new Map<string, Class<IIdentityTokenProvider>>();
}

/** Port of `ClaimsIdentityOptions` (set to the `AbpClaimTypes` by the domain module). */
export class ClaimsIdentityOptions {
  roleClaimType = "role";
  userNameClaimType = "preferred_username";
  userIdClaimType = "sub";
  emailClaimType = "email";
  securityStampClaimType = "AspNet.Identity.SecurityStamp";
}

/** Port of `Microsoft.AspNetCore.Identity.IdentityOptions`. */
export class IdentityOptions {
  claimsIdentity = new ClaimsIdentityOptions();
  user = new UserOptions();
  password = new PasswordOptions();
  lockout = new LockoutOptions();
  signIn = new SignInOptions();
  tokens = new TokenOptions();
}

/** Port of `ExternalLoginProviderInfo`. */
export class ExternalLoginProviderInfo {
  readonly name: string;
  readonly type: Class<IExternalLoginProvider>;

  constructor(name: string, type: Class<IExternalLoginProvider>) {
    this.name = Check.notNullOrWhiteSpace(name, "name");
    this.type = Check.notNull(type, "type");
  }
}

/** Port of `ExternalLoginProviderDictionary`. */
export class ExternalLoginProviderDictionary extends Map<string, ExternalLoginProviderInfo> {
  add(name: string, type: Class<IExternalLoginProvider>): this {
    this.set(name, new ExternalLoginProviderInfo(name, type));
    return this;
  }
}

/** Port of `AbpIdentityOptions`. */
export class AbpIdentityOptions {
  readonly externalLoginProviders = new ExternalLoginProviderDictionary();
}

/** Port of `AbpIdentityTokenProviderOptions` plus the key material the HMAC token providers of this port sign with. */
export class AbpIdentityTokenProviderOptions {
  useAbpTokenProviders = true;
  /**
   * Secret the token providers sign with (replaces the ASP.NET Core data-protection key ring). When unset the
   * `AbpStringEncryptionOptions.defaultPassPhrase` is used, so configure `StringEncryption:DefaultPassPhrase` in production.
   */
  signingKey: string | undefined = undefined;
}

/** Port of `AbpDataProtectionTokenProviderOptions` (`TokenLifespan` in milliseconds). */
export abstract class AbpDataProtectionTokenProviderOptions {
  name = "DataProtectorTokenProvider";
  tokenLifespanMs = 24 * 60 * 60 * 1000;
}

/** Port of `AbpDefaultTokenProviderOptions` (10 minutes). */
export class AbpDefaultTokenProviderOptions extends AbpDataProtectionTokenProviderOptions {
  constructor() {
    super();
    this.name = TokenOptions.DefaultProvider;
    this.tokenLifespanMs = 10 * 60 * 1000;
  }
}

/** Port of `AbpEmailConfirmationTokenProviderOptions` (2 hours). */
export class AbpEmailConfirmationTokenProviderOptions extends AbpDataProtectionTokenProviderOptions {
  static readonly ProviderName = "AbpEmailConfirmation";
  constructor() {
    super();
    this.name = AbpEmailConfirmationTokenProviderOptions.ProviderName;
    this.tokenLifespanMs = 2 * 60 * 60 * 1000;
  }
}

/** Port of `AbpPasswordResetTokenProviderOptions` (2 hours). */
export class AbpPasswordResetTokenProviderOptions extends AbpDataProtectionTokenProviderOptions {
  static readonly ProviderName = "AbpPasswordReset";
  constructor() {
    super();
    this.name = AbpPasswordResetTokenProviderOptions.ProviderName;
    this.tokenLifespanMs = 2 * 60 * 60 * 1000;
  }
}

/** Port of `AbpChangeEmailTokenProviderOptions` (2 hours). */
export class AbpChangeEmailTokenProviderOptions extends AbpDataProtectionTokenProviderOptions {
  static readonly ProviderName = "AbpChangeEmail";
  constructor() {
    super();
    this.name = AbpChangeEmailTokenProviderOptions.ProviderName;
    this.tokenLifespanMs = 2 * 60 * 60 * 1000;
  }
}

/** Port of `AbpLinkUserTokenProviderOptions` (10 minutes). */
export class AbpLinkUserTokenProviderOptions extends AbpDataProtectionTokenProviderOptions {
  constructor() {
    super();
    this.name = LinkUserTokenProviderConsts.linkUserTokenProviderName;
    this.tokenLifespanMs = 10 * 60 * 1000;
  }
}

/** Port of `AbpTwoFactorTokenProviderOptions` (the two-factor codes of this port expire after this time span). */
export class AbpTwoFactorTokenProviderOptions {
  tokenLifespanMs = 3 * 60 * 1000;
}

/** Port of `AbpEmailTwoFactorTokenProviderOptions`. */
export class AbpEmailTwoFactorTokenProviderOptions extends AbpTwoFactorTokenProviderOptions {}

/** Port of `AbpPhoneNumberTwoFactorTokenProviderOptions`. */
export class AbpPhoneNumberTwoFactorTokenProviderOptions extends AbpTwoFactorTokenProviderOptions {}

/** Port of `IdentityDynamicClaimsPrincipalContributorCacheOptions` (milliseconds). */
export class IdentityDynamicClaimsPrincipalContributorCacheOptions {
  cacheAbsoluteExpirationMs = 60 * 60 * 1000;
}

/**
 * Port of `AbpIdentityOptionsManager` (`AbpDynamicOptionsManager<IdentityOptions>`): the configured `IdentityOptions`
 * overridden by the identity settings. .NET applies the overrides on `IOptions<IdentityOptions>.SetAsync()`; here
 * every consumer asks the (scoped, cached) manager for `get()`, so the settings always apply.
 */
@Scoped()
export class AbpIdentityOptionsManager {
  static readonly inject = [optionsToken(IdentityOptions), ISettingProvider] as const;
  private pending: Promise<IdentityOptions> | undefined;

  constructor(
    protected readonly options: IOptions<IdentityOptions>,
    protected readonly settingProvider: ISettingProvider,
  ) {}

  get(): Promise<IdentityOptions> {
    this.pending ??= this.overrideOptions(cloneOptions(this.options.value)).catch((e: unknown) => {
      this.pending = undefined;
      throw e;
    });
    return this.pending;
  }

  /** Forgets the cached overrides so the next `get()` reads the settings again (`SetAsync` in .NET). */
  reset(): void {
    this.pending = undefined;
  }

  protected async overrideOptions(options: IdentityOptions): Promise<IdentityOptions> {
    const number = (name: string, fallback: number) => SettingProviderExtensions.getAsNumber(this.settingProvider, name, fallback);
    const boolean = (name: string, fallback: boolean) => SettingProviderExtensions.getAsBoolean(this.settingProvider, name, fallback);
    options.password.requiredLength = await number(IdentitySettingNames.Password.RequiredLength, options.password.requiredLength);
    options.password.requiredUniqueChars = await number(IdentitySettingNames.Password.RequiredUniqueChars, options.password.requiredUniqueChars);
    options.password.requireNonAlphanumeric = await boolean(IdentitySettingNames.Password.RequireNonAlphanumeric, options.password.requireNonAlphanumeric);
    options.password.requireLowercase = await boolean(IdentitySettingNames.Password.RequireLowercase, options.password.requireLowercase);
    options.password.requireUppercase = await boolean(IdentitySettingNames.Password.RequireUppercase, options.password.requireUppercase);
    options.password.requireDigit = await boolean(IdentitySettingNames.Password.RequireDigit, options.password.requireDigit);
    options.lockout.allowedForNewUsers = await boolean(IdentitySettingNames.Lockout.AllowedForNewUsers, options.lockout.allowedForNewUsers);
    options.lockout.defaultLockoutTimeSpanMs = (await number(IdentitySettingNames.Lockout.LockoutDuration, Math.floor(options.lockout.defaultLockoutTimeSpanMs / 1000))) * 1000;
    options.lockout.maxFailedAccessAttempts = await number(IdentitySettingNames.Lockout.MaxFailedAccessAttempts, options.lockout.maxFailedAccessAttempts);
    options.signIn.requireConfirmedEmail = await boolean(IdentitySettingNames.SignIn.RequireConfirmedEmail, options.signIn.requireConfirmedEmail);
    options.signIn.requireConfirmedPhoneNumber = await boolean(IdentitySettingNames.SignIn.RequireConfirmedPhoneNumber, options.signIn.requireConfirmedPhoneNumber);
    return options;
  }
}

function cloneOptions(source: IdentityOptions): IdentityOptions {
  const options = new IdentityOptions();
  Object.assign(options.claimsIdentity, source.claimsIdentity);
  Object.assign(options.user, source.user);
  Object.assign(options.password, source.password);
  Object.assign(options.lockout, source.lockout);
  Object.assign(options.signIn, source.signIn);
  Object.assign(options.tokens, source.tokens);
  return options;
}

/** Port of `ILookupNormalizer`. */
export interface ILookupNormalizer {
  normalizeName(name: string | undefined): string | undefined;
  normalizeEmail(email: string | undefined): string | undefined;
}
export const ILookupNormalizer = createToken<ILookupNormalizer>("ILookupNormalizer");

/** Port of `UpperInvariantLookupNormalizer`. */
@Transient(ILookupNormalizer)
export class UpperInvariantLookupNormalizer implements ILookupNormalizer {
  normalizeName(name: string | undefined): string | undefined {
    return name?.toUpperCase();
  }

  normalizeEmail(email: string | undefined): string | undefined {
    return email?.toUpperCase();
  }
}
