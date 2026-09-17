import { Check, ILoggerFactory, Transient, isNullOrWhiteSpace, optionsToken, type Guid, type ILogger, type IOptions, type ServiceKey } from "@abp/core";
import { AbpStringEncryptionOptions } from "@abp/security";
import { IClock } from "@abp/timing";
import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { LinkUserTokenProviderConsts } from "../domain-shared/index.js";
import type {
  AbpDataProtectionTokenProviderOptions,
  AbpTwoFactorTokenProviderOptions} from "./identity-options.js";
import {
  AbpChangeEmailTokenProviderOptions,
  AbpDefaultTokenProviderOptions,
  AbpEmailConfirmationTokenProviderOptions,
  AbpEmailTwoFactorTokenProviderOptions,
  AbpIdentityTokenProviderOptions,
  AbpLinkUserTokenProviderOptions,
  AbpPasswordResetTokenProviderOptions,
  AbpPhoneNumberTwoFactorTokenProviderOptions,
  TokenOptions,
} from "./identity-options.js";
import type { IdentityResult } from "./identity-result.js";
import type { IdentityUser } from "./identity-user.js";

/** What the token providers need from `UserManager<IdentityUser>`: persisting the user after a token was recorded. */
export interface IUserManagerForTokens {
  update(user: IdentityUser): Promise<IdentityResult>;
}

/** Port of `IUserTwoFactorTokenProvider<IdentityUser>`. */
export interface IIdentityTokenProvider {
  readonly name: string;
  generate(purpose: string, manager: IUserManagerForTokens, user: IdentityUser): Promise<string>;
  validate(purpose: string, token: string, manager: IUserManagerForTokens, user: IdentityUser): Promise<boolean>;
  canGenerateTwoFactorToken(manager: IUserManagerForTokens, user: IdentityUser): Promise<boolean>;
}

interface TokenPayload {
  readonly t: number;
  readonly u: Guid;
  readonly p: string;
  readonly s: string;
}

function base64UrlEncode(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function hmacKey(signingKey: string, providerName: string): Buffer {
  return createHash("sha256").update(`${signingKey}:${providerName}`, "utf8").digest();
}

function sign(key: Buffer, payload: string): string {
  return createHmac("sha256", key).update(payload, "utf8").digest("base64url");
}

function fixedTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex").toUpperCase();
}

/**
 * Port of `AbpSingleActiveTokenProvider` (+ `DataProtectorTokenProvider`): the payload (creation time, user id,
 * purpose, security stamp) is signed with HMAC-SHA256 instead of the ASP.NET Core data-protection key ring, and
 * the SHA-256 of the last issued token is kept in the user's tokens so only one token per purpose is active.
 */
export abstract class AbpSingleActiveTokenProvider implements IIdentityTokenProvider {
  static readonly InternalLoginProvider = "[AbpSingleActiveToken]";
  static readonly inject: readonly ServiceKey[] = [optionsToken(AbpIdentityTokenProviderOptions), optionsToken(AbpStringEncryptionOptions), IClock, ILoggerFactory];
  protected readonly logger: ILogger;
  protected readonly key: Buffer;

  protected constructor(
    protected readonly options: AbpDataProtectionTokenProviderOptions,
    tokenProviderOptions: IOptions<AbpIdentityTokenProviderOptions>,
    encryptionOptions: IOptions<AbpStringEncryptionOptions>,
    protected readonly clock: IClock,
    loggerFactory: ILoggerFactory,
  ) {
    this.key = hmacKey(tokenProviderOptions.value.signingKey ?? encryptionOptions.value.defaultPassPhrase, options.name);
    this.logger = loggerFactory.createLogger(new.target.name);
  }

  get name(): string {
    return this.options.name;
  }

  async generate(purpose: string, manager: IUserManagerForTokens, user: IdentityUser): Promise<string> {
    Check.notNull(user, "user");
    const token = this.protect(purpose, user);
    user.setToken(AbpSingleActiveTokenProvider.InternalLoginProvider, `${this.options.name}:${purpose}`, sha256Hex(token));
    (await manager.update(user)).checkErrors();
    return token;
  }

  async validate(purpose: string, token: string, _manager: IUserManagerForTokens, user: IdentityUser): Promise<boolean> {
    if (!this.unprotect(purpose, token, user)) return false;
    const storedHash = user.findToken(AbpSingleActiveTokenProvider.InternalLoginProvider, `${this.options.name}:${purpose}`)?.value;
    if (storedHash === undefined) {
      this.logger.debug(`No stored hash for the '${this.options.name}' token and the '${purpose}' purpose.`);
      return false;
    }
    return fixedTimeEquals(storedHash, sha256Hex(token));
  }

  async canGenerateTwoFactorToken(): Promise<boolean> {
    return false;
  }

  protected protect(purpose: string, user: IdentityUser): string {
    const payload: TokenPayload = { t: this.clock.now.getTime(), u: user.id, p: purpose ?? "", s: user.securityStamp ?? "" };
    const encoded = base64UrlEncode(JSON.stringify(payload));
    return `${encoded}.${sign(this.key, encoded)}`;
  }

  protected unprotect(purpose: string, token: string, user: IdentityUser): boolean {
    try {
      const separator = token.lastIndexOf(".");
      if (separator <= 0) return false;
      const encoded = token.slice(0, separator);
      if (!fixedTimeEquals(sign(this.key, encoded), token.slice(separator + 1))) {
        this.logger.debug(`Could not read the '${this.options.name}' token: the signature does not match.`);
        return false;
      }
      const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as TokenPayload;
      if (payload.t + this.options.tokenLifespanMs < this.clock.now.getTime()) {
        this.logger.debug(`Invalid expiration time for the '${this.options.name}' token.`);
        return false;
      }
      if (payload.u !== user.id) {
        this.logger.debug(`User ID of the '${this.options.name}' token does not match the current user.`);
        return false;
      }
      if (payload.p !== (purpose ?? "")) {
        this.logger.debug(`Purpose of the '${this.options.name}' token is '${payload.p}' but '${purpose}' was expected.`);
        return false;
      }
      if (payload.s !== (user.securityStamp ?? "")) {
        this.logger.debug(`Security stamp of the '${this.options.name}' token does not match the current one.`);
        return false;
      }
      return true;
    } catch {
      this.logger.debug(`Could not read the '${this.options.name}' token.`);
      return false;
    }
  }
}

function singleActiveInject<TOptions extends AbpDataProtectionTokenProviderOptions>(optionsClass: new () => TOptions) {
  return [optionsToken(optionsClass), optionsToken(AbpIdentityTokenProviderOptions), optionsToken(AbpStringEncryptionOptions), IClock, ILoggerFactory] as const;
}

/** Port of `AbpDefaultTokenProvider` (`TokenOptions.DefaultProvider`). */
@Transient()
export class AbpDefaultTokenProvider extends AbpSingleActiveTokenProvider {
  static override readonly inject = singleActiveInject(AbpDefaultTokenProviderOptions);
  constructor(options: IOptions<AbpDefaultTokenProviderOptions>, tokenProviderOptions: IOptions<AbpIdentityTokenProviderOptions>, encryptionOptions: IOptions<AbpStringEncryptionOptions>, clock: IClock, loggerFactory: ILoggerFactory) {
    super(options.value, tokenProviderOptions, encryptionOptions, clock, loggerFactory);
  }
}

/** Port of `AbpEmailConfirmationTokenProvider`. */
@Transient()
export class AbpEmailConfirmationTokenProvider extends AbpSingleActiveTokenProvider {
  static readonly ProviderName = AbpEmailConfirmationTokenProviderOptions.ProviderName;
  static override readonly inject = singleActiveInject(AbpEmailConfirmationTokenProviderOptions);
  constructor(options: IOptions<AbpEmailConfirmationTokenProviderOptions>, tokenProviderOptions: IOptions<AbpIdentityTokenProviderOptions>, encryptionOptions: IOptions<AbpStringEncryptionOptions>, clock: IClock, loggerFactory: ILoggerFactory) {
    super(options.value, tokenProviderOptions, encryptionOptions, clock, loggerFactory);
  }
}

/** Port of `AbpPasswordResetTokenProvider`. */
@Transient()
export class AbpPasswordResetTokenProvider extends AbpSingleActiveTokenProvider {
  static readonly ProviderName = AbpPasswordResetTokenProviderOptions.ProviderName;
  static override readonly inject = singleActiveInject(AbpPasswordResetTokenProviderOptions);
  constructor(options: IOptions<AbpPasswordResetTokenProviderOptions>, tokenProviderOptions: IOptions<AbpIdentityTokenProviderOptions>, encryptionOptions: IOptions<AbpStringEncryptionOptions>, clock: IClock, loggerFactory: ILoggerFactory) {
    super(options.value, tokenProviderOptions, encryptionOptions, clock, loggerFactory);
  }
}

/** Port of `AbpChangeEmailTokenProvider`. */
@Transient()
export class AbpChangeEmailTokenProvider extends AbpSingleActiveTokenProvider {
  static readonly ProviderName = AbpChangeEmailTokenProviderOptions.ProviderName;
  static override readonly inject = singleActiveInject(AbpChangeEmailTokenProviderOptions);
  constructor(options: IOptions<AbpChangeEmailTokenProviderOptions>, tokenProviderOptions: IOptions<AbpIdentityTokenProviderOptions>, encryptionOptions: IOptions<AbpStringEncryptionOptions>, clock: IClock, loggerFactory: ILoggerFactory) {
    super(options.value, tokenProviderOptions, encryptionOptions, clock, loggerFactory);
  }
}

/** Port of `LinkUserTokenProvider`. */
@Transient()
export class LinkUserTokenProvider extends AbpSingleActiveTokenProvider {
  static readonly ProviderName = LinkUserTokenProviderConsts.linkUserTokenProviderName;
  static override readonly inject = singleActiveInject(AbpLinkUserTokenProviderOptions);
  constructor(options: IOptions<AbpLinkUserTokenProviderOptions>, tokenProviderOptions: IOptions<AbpIdentityTokenProviderOptions>, encryptionOptions: IOptions<AbpStringEncryptionOptions>, clock: IClock, loggerFactory: ILoggerFactory) {
    super(options.value, tokenProviderOptions, encryptionOptions, clock, loggerFactory);
  }
}

/**
 * Port of `AbpTwoFactorTokenProvider`: a random 6-digit code whose SHA-256 and expiry are kept in the user's tokens
 * (`[AbpTwoFactorToken]` / `<provider>:<purpose>`); validation consumes the code.
 */
export abstract class AbpTwoFactorTokenProvider implements IIdentityTokenProvider {
  static readonly InternalLoginProvider = "[AbpTwoFactorToken]";
  static readonly inject: readonly ServiceKey[] = [IClock];
  abstract readonly name: string;

  protected constructor(
    protected readonly options: AbpTwoFactorTokenProviderOptions,
    protected readonly clock: IClock,
  ) {}

  abstract canGenerateTwoFactorToken(manager: IUserManagerForTokens, user: IdentityUser): Promise<boolean>;

  async generate(purpose: string, manager: IUserManagerForTokens, user: IdentityUser): Promise<string> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = this.clock.now.getTime() + this.options.tokenLifespanMs;
    user.setToken(AbpTwoFactorTokenProvider.InternalLoginProvider, `${this.name}:${purpose}`, `${sha256Hex(code)}|${expiresAt}`);
    (await manager.update(user)).checkErrors();
    return code;
  }

  async validate(purpose: string, token: string, manager: IUserManagerForTokens, user: IdentityUser): Promise<boolean> {
    const tokenName = `${this.name}:${purpose}`;
    const stored = user.findToken(AbpTwoFactorTokenProvider.InternalLoginProvider, tokenName)?.value;
    if (stored === undefined) return false;
    const [hash, expiresAt] = stored.split("|");
    if (hash === undefined || expiresAt === undefined) return false;
    if (Number(expiresAt) < this.clock.now.getTime() || !fixedTimeEquals(hash, sha256Hex(token))) return false;
    user.removeToken(AbpTwoFactorTokenProvider.InternalLoginProvider, tokenName);
    (await manager.update(user)).checkErrors();
    return true;
  }
}

/** Port of `AbpEmailTwoFactorTokenProvider` (`TokenOptions.DefaultEmailProvider`). */
@Transient()
export class AbpEmailTwoFactorTokenProvider extends AbpTwoFactorTokenProvider {
  static readonly ProviderName = "AbpEmailTwoFactor";
  static override readonly inject = [optionsToken(AbpEmailTwoFactorTokenProviderOptions), IClock] as const;
  readonly name = AbpEmailTwoFactorTokenProvider.ProviderName;

  constructor(options: IOptions<AbpEmailTwoFactorTokenProviderOptions>, clock: IClock) {
    super(options.value, clock);
  }

  async canGenerateTwoFactorToken(_manager: IUserManagerForTokens, user: IdentityUser): Promise<boolean> {
    return !isNullOrWhiteSpace(user.email) && user.emailConfirmed;
  }
}

/** Port of `AbpPhoneNumberTwoFactorTokenProvider` (`TokenOptions.DefaultPhoneProvider`). */
@Transient()
export class AbpPhoneNumberTwoFactorTokenProvider extends AbpTwoFactorTokenProvider {
  static readonly ProviderName = "AbpPhoneNumberTwoFactor";
  static override readonly inject = [optionsToken(AbpPhoneNumberTwoFactorTokenProviderOptions), IClock] as const;
  readonly name = AbpPhoneNumberTwoFactorTokenProvider.ProviderName;

  constructor(options: IOptions<AbpPhoneNumberTwoFactorTokenProviderOptions>, clock: IClock) {
    super(options.value, clock);
  }

  async canGenerateTwoFactorToken(_manager: IUserManagerForTokens, user: IdentityUser): Promise<boolean> {
    return !isNullOrWhiteSpace(user.phoneNumber) && user.phoneNumberConfirmed;
  }
}

/** Port of `AbpIdentityBuilderExtensions.AddAbpTokenProviders`: the provider map and the purposes that use the ABP providers. */
export function addAbpTokenProviders(tokens: TokenOptions): void {
  tokens.providerMap.set(TokenOptions.DefaultProvider, AbpDefaultTokenProvider);
  tokens.providerMap.set(TokenOptions.DefaultEmailProvider, AbpEmailTwoFactorTokenProvider);
  tokens.providerMap.set(TokenOptions.DefaultPhoneProvider, AbpPhoneNumberTwoFactorTokenProvider);
  tokens.providerMap.set(AbpPasswordResetTokenProvider.ProviderName, AbpPasswordResetTokenProvider);
  tokens.providerMap.set(AbpEmailConfirmationTokenProvider.ProviderName, AbpEmailConfirmationTokenProvider);
  tokens.providerMap.set(AbpChangeEmailTokenProvider.ProviderName, AbpChangeEmailTokenProvider);
  tokens.providerMap.set(LinkUserTokenProvider.ProviderName, LinkUserTokenProvider);
  tokens.passwordResetTokenProvider = AbpPasswordResetTokenProvider.ProviderName;
  tokens.emailConfirmationTokenProvider = AbpEmailConfirmationTokenProvider.ProviderName;
  tokens.changeEmailTokenProvider = AbpChangeEmailTokenProvider.ProviderName;
}
