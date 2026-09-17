import { AbpException, BusinessException, Check, IServiceProviderToken, Transient, isNullOrEmptyString, isNullOrWhiteSpace, type Guid, type IServiceProvider } from "@abp/core";
import type { IDistributedCache } from "@abp/caching";
import { AbpDbConcurrencyException } from "@abp/data";
import { DomainService, EntityNotFoundException } from "@abp/ddd-domain";
import { IDistributedEventBus } from "@abp/event-bus";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { AbpDynamicClaimCacheItem, type Claim } from "@abp/security";
import { ISettingProvider, SettingProviderExtensions } from "@abp/settings";
import { IdentityErrorCodes, IdentitySettingNames, IdentityUserEmailChangedEto, IdentityUserPasswordChangedEto, IdentityUserUserNameChangedEto } from "../domain-shared/index.js";
import { AbpIdentityErrorDescriber } from "./abp-identity-error-describer.js";
import { IAbpDynamicClaimCache } from "./abp-dynamic-claim-cache.js";
import { AbpIdentityOptionsManager, ILookupNormalizer, type IdentityOptions } from "./identity-options.js";
import { IdentityResult, SignInResult } from "./identity-result.js";
import type { IdentityRole } from "./identity-role.js";
import { IdentityLinkUserInfo } from "./identity-link-user.js";
import { isUserLockedOut, type IdentityUser, type UserLoginInfo } from "./identity-user.js";
import type { OrganizationUnit } from "./organization-unit.js";
import { IPasswordHasher, PasswordVerificationResult } from "./password-hasher.js";
import { IIdentityLinkUserRepository, IIdentityRoleRepository, IIdentityUserRepository, IOrganizationUnitRepository } from "./repositories.js";
import type { IIdentityTokenProvider } from "./token-providers.js";
import { IPasswordValidator, IUserValidator, type IUserManagerForValidation } from "./validators.js";

/** Port of `UserManager<TUser>.ResetPasswordTokenPurpose` / `ConfirmEmailTokenPurpose` / `ChangePhoneNumberTokenPurpose`. */
export const UserManagerTokenPurposes = {
  ResetPassword: "ResetPassword",
  ConfirmEmail: "EmailConfirmation",
  ChangePhoneNumber: "ChangePhoneNumber",
  ChangeEmail: (newEmail: string) => `ChangeEmail:${newEmail}`,
} as const;

const RandomUserNameCharacters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._@+";

/**
 * Port of `IdentityUserManager` together with the parts of ASP.NET Core's `UserManager<TUser>` / `IdentityUserStore`
 * ABP relies on (there is no ASP.NET Core Identity here). Writes go straight through `IIdentityUserRepository`
 * with `autoSave` (`IdentityUserStore.AutoSaveChanges` is true in ABP). `IdentityOptions` are always read through
 * `AbpIdentityOptionsManager`, so the setting overrides apply without an explicit `SetAsync`. Passkeys, recovery
 * codes and the authenticator provider are not ported; the `TenantUserSharingStrategy.Shared` lookups behave like `Isolated`.
 */
@Transient()
export class IdentityUserManager extends DomainService {
  static readonly inject = [
    IIdentityUserRepository,
    IIdentityRoleRepository,
    IOrganizationUnitRepository,
    IIdentityLinkUserRepository,
    AbpIdentityOptionsManager,
    IPasswordHasher,
    ILookupNormalizer,
    AbpIdentityErrorDescriber,
    IServiceProviderToken,
    ISettingProvider,
    IDistributedEventBus,
    IAbpDynamicClaimCache,
    ICurrentTenant,
  ] as const;

  constructor(
    protected readonly userRepository: IIdentityUserRepository,
    protected readonly roleRepository: IIdentityRoleRepository,
    protected readonly organizationUnitRepository: IOrganizationUnitRepository,
    protected readonly identityLinkUserRepository: IIdentityLinkUserRepository,
    protected readonly optionsManager: AbpIdentityOptionsManager,
    protected readonly passwordHasher: IPasswordHasher,
    protected readonly keyNormalizer: ILookupNormalizer,
    readonly errorDescriber: AbpIdentityErrorDescriber,
    protected readonly serviceProvider: IServiceProvider,
    protected readonly settingProvider: ISettingProvider,
    protected readonly distributedEventBus: IDistributedEventBus,
    protected readonly dynamicClaimCache: IDistributedCache<AbpDynamicClaimCacheItem>,
    protected readonly tenant: ICurrentTenant,
  ) {
    super();
  }

  /** The effective `IdentityOptions` (configured options overridden by the identity settings). */
  getOptions(): Promise<IdentityOptions> {
    return this.optionsManager.get();
  }

  normalizeName(name: string | undefined): string | undefined {
    return this.keyNormalizer.normalizeName(name);
  }

  normalizeEmail(email: string | undefined): string | undefined {
    return this.keyNormalizer.normalizeEmail(email);
  }

  /** Port of `FindTokenProvider` / `RegisterTokenProvider`: resolves the provider registered under `providerName`. */
  async findTokenProvider(providerName: string): Promise<IIdentityTokenProvider | undefined> {
    const type = (await this.getOptions()).tokens.providerMap.get(providerName);
    return type === undefined ? undefined : this.serviceProvider.get(type);
  }

  /* ----- create / update / delete ----- */

  /** Port of `CreateAsync(user)`, `CreateAsync(user, password)` and ABP's `CreateAsync(user, password, validatePassword)`. */
  async create(user: IdentityUser, password?: string, validatePassword = true): Promise<IdentityResult> {
    Check.notNull(user, "user");
    if (password !== undefined) {
      const result = await this.updatePasswordHash(user, password, validatePassword);
      if (!result.succeeded) return result;
    }
    this.updateSecurityStampInternal(user);
    const validation = await this.validateUser(user);
    if (!validation.succeeded) return validation;
    if ((await this.getOptions()).lockout.allowedForNewUsers) user.lockoutEnabled = true;
    this.updateNormalizedNames(user);
    await this.userRepository.insert(user, true);
    return IdentityResult.Success;
  }

  /** Port of `UpdateAsync(user)`. */
  async update(user: IdentityUser): Promise<IdentityResult> {
    Check.notNull(user, "user");
    return this.updateUser(user);
  }

  /** Port of ABP's `DeleteAsync`: clears the sub-collections, deletes the host-side link users, then the user. */
  async delete(user: IdentityUser): Promise<IdentityResult> {
    Check.notNull(user, "user");
    user.claims.length = 0;
    user.roles.length = 0;
    user.tokens.length = 0;
    user.logins.length = 0;
    user.organizationUnits.length = 0;
    try {
      await this.userRepository.update(user, true);
    } catch (e) {
      if (e instanceof AbpDbConcurrencyException) return IdentityResult.failed(this.errorDescriber.concurrencyFailure());
      throw e;
    }
    await this.tenant.run(undefined, undefined, () => this.identityLinkUserRepository.deleteAllOf(new IdentityLinkUserInfo(user.id, user.tenantId)));
    try {
      await this.userRepository.delete(user, true);
    } catch (e) {
      if (e instanceof AbpDbConcurrencyException) return IdentityResult.failed(this.errorDescriber.concurrencyFailure());
      throw e;
    }
    return IdentityResult.Success;
  }

  /** Port of `UpdateUserAsync`: validates, normalizes and persists; a lost concurrency race is a `ConcurrencyFailure`. */
  protected async updateUser(user: IdentityUser): Promise<IdentityResult> {
    const validation = await this.validateUser(user);
    if (!validation.succeeded) return validation;
    this.updateNormalizedNames(user);
    try {
      await this.userRepository.update(user, true);
    } catch (e) {
      if (e instanceof AbpDbConcurrencyException) return IdentityResult.failed(this.errorDescriber.concurrencyFailure());
      throw e;
    }
    await this.dynamicClaimCache.remove(AbpDynamicClaimCacheItem.calculateCacheKey(user.id, user.tenantId));
    return IdentityResult.Success;
  }

  protected updateNormalizedNames(user: IdentityUser): void {
    user.setUserNameWithoutValidation(user.userName, this.normalizeName(user.userName) ?? user.userName.toUpperCase());
    user.setEmailWithoutValidation(user.email, this.normalizeEmail(user.email) ?? user.email.toUpperCase());
  }

  /** Port of `ValidateUserAsync` (also exposed by ABP as `CallValidateUserAsync`). */
  async validateUser(user: IdentityUser): Promise<IdentityResult> {
    const context = await this.validationContext();
    const errors = [];
    for (const validator of this.serviceProvider.getAll(IUserValidator)) {
      const result = await validator.validate(context, user);
      if (!result.succeeded) errors.push(...result.errors);
    }
    return errors.length > 0 ? IdentityResult.failed(...errors) : IdentityResult.Success;
  }

  /** Port of `ValidatePasswordAsync` (`CallValidatePasswordAsync`). */
  async validatePassword(user: IdentityUser, password: string | undefined): Promise<IdentityResult> {
    const context = await this.validationContext();
    const errors = [];
    for (const validator of this.serviceProvider.getAll(IPasswordValidator)) {
      const result = await validator.validate(context, user, password);
      if (!result.succeeded) errors.push(...result.errors);
    }
    return errors.length > 0 ? IdentityResult.failed(...errors) : IdentityResult.Success;
  }

  private async validationContext(): Promise<IUserManagerForValidation> {
    return { errorDescriber: this.errorDescriber, options: await this.getOptions(), findByName: (userName) => this.findByName(userName), findByEmail: (email) => this.findByEmail(email) };
  }

  /* ----- lookups ----- */

  async findById(id: Guid): Promise<IdentityUser | undefined> {
    return this.userRepository.find(id);
  }

  async getById(id: Guid): Promise<IdentityUser> {
    const user = await this.findById(id);
    if (!user) throw new EntityNotFoundException(this.userRepository.entityType, id);
    return user;
  }

  async findByName(userName: string): Promise<IdentityUser | undefined> {
    Check.notNull(userName, "userName");
    return this.userRepository.findByNormalizedUserName(this.normalizeName(userName) ?? userName);
  }

  async findByEmail(email: string): Promise<IdentityUser | undefined> {
    Check.notNull(email, "email");
    return this.userRepository.findByNormalizedEmail(this.normalizeEmail(email) ?? email);
  }

  async findByLogin(loginProvider: string, providerKey: string): Promise<IdentityUser | undefined> {
    return this.userRepository.findByLogin(Check.notNull(loginProvider, "loginProvider"), Check.notNull(providerKey, "providerKey"));
  }

  /** Port of `FindSharedUserByNameAsync` (only the `Isolated` strategy is ported: the current tenant is searched). */
  findSharedUserByName(userName: string): Promise<IdentityUser | undefined> {
    return this.findByName(userName);
  }

  findSharedUserByEmail(email: string): Promise<IdentityUser | undefined> {
    return this.findByEmail(email);
  }

  findSharedUserByLogin(loginProvider: string, providerKey: string): Promise<IdentityUser | undefined> {
    return this.findByLogin(loginProvider, providerKey);
  }

  findSharedUserById(userId: Guid): Promise<IdentityUser | undefined> {
    return this.findById(userId);
  }

  /* ----- user name / email / phone ----- */

  /** Port of ABP's `SetUserNameAsync`: throws on failure and publishes `IdentityUserUserNameChangedEto`. */
  async setUserName(user: IdentityUser, userName: string): Promise<IdentityResult> {
    Check.notNull(user, "user");
    const oldUserName = user.userName;
    user.setUserNameWithoutValidation(userName, this.normalizeName(userName) ?? userName.toUpperCase());
    this.updateSecurityStampInternal(user);
    const result = await this.updateUser(user);
    result.checkErrors();
    if (!isNullOrEmptyString(oldUserName) && oldUserName !== userName) {
      const eto = new IdentityUserUserNameChangedEto();
      eto.id = user.id;
      eto.tenantId = user.tenantId;
      eto.userName = userName;
      eto.oldUserName = oldUserName;
      await this.distributedEventBus.publish(eto);
    }
    return result;
  }

  /** Port of ABP's `SetEmailAsync`: throws on failure and publishes `IdentityUserEmailChangedEto`. */
  async setEmail(user: IdentityUser, email: string): Promise<IdentityResult> {
    Check.notNull(user, "user");
    const oldMail = user.email;
    user.setEmailWithoutValidation(email, this.normalizeEmail(email) ?? email.toUpperCase());
    user.setEmailConfirmed(false);
    this.updateSecurityStampInternal(user);
    const result = await this.updateUser(user);
    result.checkErrors();
    if (!isNullOrEmptyString(oldMail) && oldMail.toLowerCase() !== email.toLowerCase()) {
      const eto = new IdentityUserEmailChangedEto();
      eto.id = user.id;
      eto.tenantId = user.tenantId;
      eto.email = email;
      eto.oldEmail = oldMail;
      await this.distributedEventBus.publish(eto);
    }
    return result;
  }

  async isEmailConfirmed(user: IdentityUser): Promise<boolean> {
    return Check.notNull(user, "user").emailConfirmed;
  }

  async generateEmailConfirmationToken(user: IdentityUser): Promise<string> {
    return this.generateUserToken(user, (await this.getOptions()).tokens.emailConfirmationTokenProvider, UserManagerTokenPurposes.ConfirmEmail);
  }

  async confirmEmail(user: IdentityUser, token: string): Promise<IdentityResult> {
    Check.notNull(user, "user");
    if (!(await this.verifyUserToken(user, (await this.getOptions()).tokens.emailConfirmationTokenProvider, UserManagerTokenPurposes.ConfirmEmail, token))) {
      return IdentityResult.failed(this.errorDescriber.invalidToken());
    }
    user.setEmailConfirmed(true);
    return this.updateUser(user);
  }

  async setPhoneNumber(user: IdentityUser, phoneNumber: string | undefined): Promise<IdentityResult> {
    Check.notNull(user, "user");
    user.setPhoneNumber(phoneNumber, false);
    this.updateSecurityStampInternal(user);
    return this.updateUser(user);
  }

  async isPhoneNumberConfirmed(user: IdentityUser): Promise<boolean> {
    return Check.notNull(user, "user").phoneNumberConfirmed;
  }

  /* ----- passwords ----- */

  async hasPassword(user: IdentityUser): Promise<boolean> {
    return !isNullOrEmptyString(Check.notNull(user, "user").passwordHash);
  }

  /** Port of `CheckPasswordAsync`: verifies and rehashes when the stored hash needs an upgrade. */
  async checkPassword(user: IdentityUser | undefined, password: string): Promise<boolean> {
    if (!user) return false;
    const result = this.verifyPassword(user, password);
    if (result === PasswordVerificationResult.SuccessRehashNeeded) {
      await this.updatePasswordHash(user, password, false);
      await this.updateUser(user);
    }
    return result !== PasswordVerificationResult.Failed;
  }

  protected verifyPassword(user: IdentityUser, password: string): PasswordVerificationResult {
    const hash = user.passwordHash;
    if (isNullOrEmptyString(hash)) return PasswordVerificationResult.Failed;
    return this.passwordHasher.verifyHashedPassword(user, hash, password);
  }

  async addPassword(user: IdentityUser, password: string): Promise<IdentityResult> {
    Check.notNull(user, "user");
    if (!isNullOrEmptyString(user.passwordHash)) return IdentityResult.failed(this.errorDescriber.userAlreadyHasPassword());
    const result = await this.updatePasswordHash(user, password, true);
    if (!result.succeeded) return result;
    return this.updateUser(user);
  }

  /** Port of ABP's `ChangePasswordAsync`: throws on failure and publishes `IdentityUserPasswordChangedEto`. */
  async changePassword(user: IdentityUser, currentPassword: string, newPassword: string): Promise<IdentityResult> {
    Check.notNull(user, "user");
    let result: IdentityResult;
    if (this.verifyPassword(user, currentPassword) !== PasswordVerificationResult.Failed) {
      result = await this.updatePasswordHash(user, newPassword, true);
      if (result.succeeded) result = await this.updateUser(user);
    } else {
      result = IdentityResult.failed(this.errorDescriber.passwordMismatch());
    }
    result.checkErrors();
    const eto = new IdentityUserPasswordChangedEto();
    eto.id = user.id;
    eto.tenantId = user.tenantId;
    eto.email = user.email;
    await this.distributedEventBus.publish(eto);
    return result;
  }

  async removePassword(user: IdentityUser): Promise<IdentityResult> {
    Check.notNull(user, "user");
    await this.updatePasswordHash(user, undefined, false);
    return this.updateUser(user);
  }

  async generatePasswordResetToken(user: IdentityUser): Promise<string> {
    return this.generateUserToken(user, (await this.getOptions()).tokens.passwordResetTokenProvider, UserManagerTokenPurposes.ResetPassword);
  }

  async resetPassword(user: IdentityUser, token: string, newPassword: string): Promise<IdentityResult> {
    Check.notNull(user, "user");
    if (!(await this.verifyUserToken(user, (await this.getOptions()).tokens.passwordResetTokenProvider, UserManagerTokenPurposes.ResetPassword, token))) {
      return IdentityResult.failed(this.errorDescriber.invalidToken());
    }
    const result = await this.updatePasswordHash(user, newPassword, true);
    if (!result.succeeded) return result;
    return this.updateUser(user);
  }

  /** Port of `UpdatePasswordHash` (`CallUpdatePasswordHash` in ABP): validates, hashes and rotates the security stamp. */
  async updatePasswordHash(user: IdentityUser, newPassword: string | undefined, validatePassword = true): Promise<IdentityResult> {
    if (validatePassword) {
      const validation = await this.validatePassword(user, newPassword);
      if (!validation.succeeded) return validation;
    }
    user.setPasswordHashWithoutValidation(newPassword === undefined ? undefined : this.passwordHasher.hashPassword(user, newPassword));
    user.setLastPasswordChangeTime(this.clock.now);
    this.updateSecurityStampInternal(user);
    return IdentityResult.Success;
  }

  /** Port of `ShouldPeriodicallyChangePasswordAsync`. */
  async shouldPeriodicallyChangePassword(user: IdentityUser): Promise<boolean> {
    Check.notNull(user, "user");
    if (isNullOrWhiteSpace(user.passwordHash)) return false;
    if (!(await SettingProviderExtensions.getAsBoolean(this.settingProvider, IdentitySettingNames.Password.ForceUsersToPeriodicallyChangePassword, false))) return false;
    const lastPasswordChangeTime = user.lastPasswordChangeTime ?? user.creationTime;
    const passwordChangePeriodDays = await SettingProviderExtensions.getAsNumber(this.settingProvider, IdentitySettingNames.Password.PasswordChangePeriodDays, 0);
    return passwordChangePeriodDays > 0 && lastPasswordChangeTime.getTime() + passwordChangePeriodDays * 24 * 60 * 60 * 1000 < this.clock.now.getTime();
  }

  /* ----- tokens ----- */

  async generateUserToken(user: IdentityUser, tokenProvider: string, purpose: string): Promise<string> {
    Check.notNull(user, "user");
    const provider = await this.findTokenProvider(Check.notNull(tokenProvider, "tokenProvider"));
    if (!provider) throw new AbpException(`No IUserTwoFactorTokenProvider named '${tokenProvider}' is registered.`);
    return provider.generate(purpose, this, user);
  }

  async verifyUserToken(user: IdentityUser, tokenProvider: string, purpose: string, token: string): Promise<boolean> {
    Check.notNull(user, "user");
    const provider = await this.findTokenProvider(Check.notNull(tokenProvider, "tokenProvider"));
    if (!provider) throw new AbpException(`No IUserTwoFactorTokenProvider named '${tokenProvider}' is registered.`);
    const result = await provider.validate(purpose, token, this, user);
    if (!result) this.logger.debug(`VerifyUserTokenAsync() failed with purpose: ${purpose} for user.`);
    return result;
  }

  async generateTwoFactorToken(user: IdentityUser, tokenProvider: string): Promise<string> {
    const provider = await this.findTokenProvider(tokenProvider);
    if (!provider) throw new AbpException(`No IUserTwoFactorTokenProvider named '${tokenProvider}' is registered.`);
    return provider.generate("TwoFactor", this, user);
  }

  async verifyTwoFactorToken(user: IdentityUser, tokenProvider: string, token: string): Promise<boolean> {
    const provider = await this.findTokenProvider(tokenProvider);
    if (!provider) throw new AbpException(`No IUserTwoFactorTokenProvider named '${tokenProvider}' is registered.`);
    return provider.validate("TwoFactor", token, this, user);
  }

  async getValidTwoFactorProviders(user: IdentityUser): Promise<string[]> {
    Check.notNull(user, "user");
    const results: string[] = [];
    for (const [name, type] of (await this.getOptions()).tokens.providerMap) {
      const provider = this.serviceProvider.get(type);
      if (provider && (await provider.canGenerateTwoFactorToken(this, user))) results.push(name);
    }
    return results;
  }

  async getTwoFactorEnabled(user: IdentityUser): Promise<boolean> {
    return Check.notNull(user, "user").twoFactorEnabled;
  }

  async setTwoFactorEnabled(user: IdentityUser, enabled: boolean): Promise<IdentityResult> {
    Check.notNull(user, "user");
    user.twoFactorEnabled = enabled;
    this.updateSecurityStampInternal(user);
    return this.updateUser(user);
  }

  async setAuthenticationToken(user: IdentityUser, loginProvider: string, tokenName: string, tokenValue: string | undefined): Promise<IdentityResult> {
    Check.notNull(user, "user");
    user.setToken(Check.notNull(loginProvider, "loginProvider"), Check.notNull(tokenName, "tokenName"), tokenValue);
    return this.updateUser(user);
  }

  async getAuthenticationToken(user: IdentityUser, loginProvider: string, tokenName: string): Promise<string | undefined> {
    return Check.notNull(user, "user").findToken(loginProvider, tokenName)?.value;
  }

  async removeAuthenticationToken(user: IdentityUser, loginProvider: string, tokenName: string): Promise<IdentityResult> {
    Check.notNull(user, "user");
    user.removeToken(loginProvider, tokenName);
    return this.updateUser(user);
  }

  /* ----- security stamp ----- */

  async getSecurityStamp(user: IdentityUser): Promise<string> {
    const stamp = Check.notNull(user, "user").securityStamp;
    if (isNullOrEmptyString(stamp)) throw new AbpException("User security stamp cannot be null.");
    return stamp;
  }

  async updateSecurityStamp(user: IdentityUser): Promise<IdentityResult> {
    Check.notNull(user, "user");
    this.updateSecurityStampInternal(user);
    return this.updateUser(user);
  }

  protected updateSecurityStampInternal(user: IdentityUser): void {
    user.securityStamp = this.guidGenerator.create().replace(/-/g, "");
  }

  /* ----- lockout ----- */

  async isLockedOut(user: IdentityUser): Promise<boolean> {
    return isUserLockedOut(Check.notNull(user, "user"), this.clock.now);
  }

  async setLockoutEnabled(user: IdentityUser, enabled: boolean): Promise<IdentityResult> {
    Check.notNull(user, "user");
    user.lockoutEnabled = enabled;
    return this.updateUser(user);
  }

  async getLockoutEnabled(user: IdentityUser): Promise<boolean> {
    return Check.notNull(user, "user").lockoutEnabled;
  }

  async setLockoutEndDate(user: IdentityUser, lockoutEnd: Date | undefined): Promise<IdentityResult> {
    Check.notNull(user, "user");
    if (!user.lockoutEnabled) return IdentityResult.failed(this.errorDescriber.userLockoutNotEnabled());
    user.lockoutEnd = lockoutEnd;
    return this.updateUser(user);
  }

  /** Port of `AccessFailedAsync`: counts the failure and locks the user out when the limit is reached. */
  async accessFailed(user: IdentityUser): Promise<IdentityResult> {
    Check.notNull(user, "user");
    const options = await this.getOptions();
    user.accessFailedCount += 1;
    if (user.accessFailedCount >= options.lockout.maxFailedAccessAttempts) {
      user.lockoutEnd = new Date(this.clock.now.getTime() + options.lockout.defaultLockoutTimeSpanMs);
      user.accessFailedCount = 0;
    }
    return this.updateUser(user);
  }

  async resetAccessFailedCount(user: IdentityUser): Promise<IdentityResult> {
    Check.notNull(user, "user");
    if (user.accessFailedCount === 0) return IdentityResult.Success;
    user.accessFailedCount = 0;
    return this.updateUser(user);
  }

  async getAccessFailedCount(user: IdentityUser): Promise<number> {
    return Check.notNull(user, "user").accessFailedCount;
  }

  /* ----- sign-in checks (port of SignInManager.CheckPasswordSignInAsync + AbpSignInManager.PreSignInCheck) ----- */

  /** Port of `SignInManager.CanSignInAsync`: confirmed email / phone number when the options require them. */
  async canSignIn(user: IdentityUser): Promise<boolean> {
    const options = await this.getOptions();
    if (options.signIn.requireConfirmedEmail && !user.emailConfirmed) {
      this.logger.debug(`User cannot sign in without a confirmed email.`);
      return false;
    }
    if (options.signIn.requireConfirmedPhoneNumber && !user.phoneNumberConfirmed) {
      this.logger.debug(`User cannot sign in without a confirmed phone number.`);
      return false;
    }
    return true;
  }

  /** Port of `AbpSignInManager.PreSignInCheck`: inactive users, pending password changes, unconfirmed accounts and lockouts. */
  async preSignInCheck(user: IdentityUser): Promise<SignInResult | undefined> {
    if (!user.isActive) {
      this.logger.warn(`The user is not active therefore cannot login! (username: "${user.userName}", id:"${user.id}")`);
      return SignInResult.NotAllowed;
    }
    if (user.shouldChangePasswordOnNextLogin) {
      this.logger.warn(`The user should change password! (username: "${user.userName}", id:"${user.id}")`);
      return SignInResult.NotAllowed;
    }
    if (await this.shouldPeriodicallyChangePassword(user)) return SignInResult.NotAllowed;
    if (!(await this.canSignIn(user))) return SignInResult.NotAllowed;
    if (await this.isLockedOut(user)) return SignInResult.LockedOut;
    return undefined;
  }

  /** Port of `SignInManager.CheckPasswordSignInAsync` (with ABP's pre-sign-in checks). */
  async checkPasswordSignIn(user: IdentityUser, password: string, lockoutOnFailure: boolean): Promise<SignInResult> {
    Check.notNull(user, "user");
    const error = await this.preSignInCheck(user);
    if (error) return error;

    if (await this.checkPassword(user, password)) {
      if (!user.twoFactorEnabled) (await this.resetAccessFailedCount(user)).checkErrors();
      return SignInResult.Success;
    }

    this.logger.debug(`User failed to provide the correct password.`);
    if (lockoutOnFailure) {
      const incrementResult = await this.accessFailed(user);
      if (!incrementResult.succeeded) return SignInResult.Failed;
      if (await this.isLockedOut(user)) return SignInResult.LockedOut;
    }
    return SignInResult.Failed;
  }

  /** Port of `UpdateLastSignInTimeAsync`: best effort, after the current unit of work completes. */
  async updateLastSignInTime(id: Guid, lastSignInTime?: Date): Promise<void> {
    const time = lastSignInTime ?? this.clock.now;
    const currentUow = this.currentUnitOfWork;
    if (currentUow) {
      const tenantId = this.tenant.id;
      currentUow.onCompleted(() => this.tenant.run(tenantId, undefined, () => this.tryUpdateLastSignInTime(id, time)));
      return;
    }
    await this.tryUpdateLastSignInTime(id, time);
  }

  protected async tryUpdateLastSignInTime(id: Guid, lastSignInTime: Date): Promise<void> {
    try {
      const uow = this.unitOfWorkManager.begin(undefined, true);
      try {
        const user = await this.userRepository.find(id);
        if (!user || (user.lastSignInTime !== undefined && user.lastSignInTime >= lastSignInTime)) return;
        user.setLastSignInTime(lastSignInTime);
        const result = await this.update(user);
        if (result.succeeded) await uow.complete();
      } finally {
        await uow.dispose();
      }
    } catch (e) {
      this.logger.logException(e);
    }
  }

  /* ----- roles ----- */

  async getRoles(user: IdentityUser): Promise<string[]> {
    return this.userRepository.getRoleNames(Check.notNull(user, "user").id);
  }

  async isInRole(user: IdentityUser, role: string): Promise<boolean> {
    const normalized = this.normalizeName(role);
    const roleEntity = normalized === undefined ? undefined : await this.roleRepository.findByNormalizedName(normalized);
    return roleEntity !== undefined && Check.notNull(user, "user").isInRole(roleEntity.id);
  }

  async addToRole(user: IdentityUser, role: string): Promise<IdentityResult> {
    return this.addToRoles(user, [role]);
  }

  async addToRoles(user: IdentityUser, roles: Iterable<string>): Promise<IdentityResult> {
    Check.notNull(user, "user");
    for (const role of Check.notNull(roles, "roles")) {
      const roleEntity = await this.findRoleByName(role);
      if (!roleEntity) return IdentityResult.failed(this.errorDescriber.roleNotFound(role));
      if (user.isInRole(roleEntity.id)) return IdentityResult.failed(this.errorDescriber.userAlreadyInRole(role));
      user.addRole(roleEntity.id);
    }
    return this.updateUser(user);
  }

  async removeFromRole(user: IdentityUser, role: string): Promise<IdentityResult> {
    return this.removeFromRoles(user, [role]);
  }

  async removeFromRoles(user: IdentityUser, roles: Iterable<string>): Promise<IdentityResult> {
    Check.notNull(user, "user");
    for (const role of Check.notNull(roles, "roles")) {
      const roleEntity = await this.findRoleByName(role);
      if (!roleEntity) return IdentityResult.failed(this.errorDescriber.roleNotFound(role));
      if (!user.isInRole(roleEntity.id)) return IdentityResult.failed(this.errorDescriber.userNotInRole(role));
      user.removeRole(roleEntity.id);
    }
    return this.updateUser(user);
  }

  private async findRoleByName(role: string): Promise<IdentityRole | undefined> {
    const normalized = this.normalizeName(role);
    return normalized === undefined ? undefined : this.roleRepository.findByNormalizedName(normalized);
  }

  /** Port of `SetRolesAsync`: makes the user's direct roles exactly `roleNames`. */
  async setRoles(user: IdentityUser, roleNames: Iterable<string>): Promise<IdentityResult> {
    Check.notNull(user, "user");
    const wanted = [...new Set(Check.notNull(roleNames, "roleNames"))];
    const currentRoleNames = await this.getDirectRoleNames(user);
    let result = await this.removeFromRoles(user, currentRoleNames.filter((name) => !wanted.includes(name)));
    if (!result.succeeded) return result;
    result = await this.addToRoles(user, wanted.filter((name) => !currentRoleNames.includes(name)));
    if (!result.succeeded) return result;
    return IdentityResult.Success;
  }

  /** The names of the roles the user holds directly (`GetRolesAsync` also reports organization-unit roles, which `SetRolesAsync` must not remove). */
  protected async getDirectRoleNames(user: IdentityUser): Promise<string[]> {
    const roles = await this.roleRepository.getListByIds(user.roles.map((r) => r.roleId));
    return roles.map((r) => r.name);
  }

  /** Port of `AddDefaultRolesAsync`. */
  async addDefaultRoles(user: IdentityUser): Promise<IdentityResult> {
    Check.notNull(user, "user");
    for (const role of await this.roleRepository.getDefaultOnes()) {
      if (!user.isInRole(role.id)) user.addRole(role.id);
    }
    return this.updateUser(user);
  }

  /** Port of `UpdateRoleAsync`: moves the users of `sourceRoleId` to `targetRoleId` (or just removes the role). */
  async updateRole(sourceRoleId: Guid, targetRoleId: Guid | undefined): Promise<void> {
    const sourceRole = await this.roleRepository.get(sourceRoleId);
    this.logger.debug(`Remove dynamic claims cache for users of role: ${sourceRoleId}`);
    await this.removeDynamicClaimCacheOfUsers(await this.userRepository.getUserIdListByRoleId(sourceRoleId), sourceRole.tenantId);
    if (targetRoleId !== undefined) {
      const targetRole = await this.roleRepository.get(targetRoleId);
      this.logger.debug(`Remove dynamic claims cache for users of role: ${targetRoleId}`);
      await this.removeDynamicClaimCacheOfUsers(await this.userRepository.getUserIdListByRoleId(targetRoleId), targetRole.tenantId);
    }
    await this.userRepository.updateRole(sourceRoleId, targetRoleId);
  }

  /** Port of `UpdateOrganizationAsync`. */
  async updateOrganization(sourceOrganizationId: Guid, targetOrganizationId: Guid | undefined): Promise<void> {
    const sourceOrganization = await this.organizationUnitRepository.get(sourceOrganizationId);
    await this.removeDynamicClaimCacheOfUsers(await this.organizationUnitRepository.getMemberIds(sourceOrganizationId, true), sourceOrganization.tenantId);
    if (targetOrganizationId !== undefined) {
      const targetOrganization = await this.organizationUnitRepository.get(targetOrganizationId);
      await this.removeDynamicClaimCacheOfUsers(await this.organizationUnitRepository.getMemberIds(targetOrganizationId, true), targetOrganization.tenantId);
    }
    await this.userRepository.updateOrganization(sourceOrganizationId, targetOrganizationId);
  }

  protected async removeDynamicClaimCacheOfUsers(userIds: readonly Guid[], tenantId: Guid | undefined): Promise<void> {
    if (userIds.length === 0) return;
    await this.dynamicClaimCache.removeMany(userIds.map((userId) => AbpDynamicClaimCacheItem.calculateCacheKey(userId, tenantId)));
  }

  /* ----- claims ----- */

  async getClaims(user: IdentityUser): Promise<Claim[]> {
    return Check.notNull(user, "user").claims.map((c) => c.toClaim());
  }

  async addClaim(user: IdentityUser, claim: Claim): Promise<IdentityResult> {
    return this.addClaims(user, [claim]);
  }

  async addClaims(user: IdentityUser, claims: Iterable<Claim>): Promise<IdentityResult> {
    Check.notNull(user, "user");
    user.addClaims(this.guidGenerator, Check.notNull(claims, "claims"));
    return this.updateUser(user);
  }

  async replaceClaim(user: IdentityUser, claim: Claim, newClaim: Claim): Promise<IdentityResult> {
    Check.notNull(user, "user");
    user.replaceClaim(claim, newClaim);
    return this.updateUser(user);
  }

  async removeClaim(user: IdentityUser, claim: Claim): Promise<IdentityResult> {
    return this.removeClaims(user, [claim]);
  }

  async removeClaims(user: IdentityUser, claims: Iterable<Claim>): Promise<IdentityResult> {
    Check.notNull(user, "user");
    user.removeClaims(Check.notNull(claims, "claims"));
    return this.updateUser(user);
  }

  /* ----- logins ----- */

  async getLogins(user: IdentityUser): Promise<UserLoginInfo[]> {
    return Check.notNull(user, "user").logins.map((l) => l.toUserLoginInfo());
  }

  async addLogin(user: IdentityUser, login: UserLoginInfo): Promise<IdentityResult> {
    Check.notNull(user, "user");
    Check.notNull(login, "login");
    const existing = await this.findByLogin(login.loginProvider, login.providerKey);
    if (existing) {
      this.logger.debug(`AddLogin for user failed because it was already associated with another user.`);
      return IdentityResult.failed(this.errorDescriber.loginAlreadyAssociated());
    }
    user.addLogin(login);
    return this.updateUser(user);
  }

  async removeLogin(user: IdentityUser, loginProvider: string, providerKey: string): Promise<IdentityResult> {
    Check.notNull(user, "user");
    user.removeLogin(loginProvider, providerKey);
    this.updateSecurityStampInternal(user);
    return this.updateUser(user);
  }

  /* ----- organization units ----- */

  async isInOrganizationUnit(userOrId: IdentityUser | Guid, organizationUnitOrId: OrganizationUnit | Guid): Promise<boolean> {
    const user = typeof userOrId === "string" ? await this.userRepository.get(userOrId) : userOrId;
    return user.isInOrganizationUnit(typeof organizationUnitOrId === "string" ? organizationUnitOrId : organizationUnitOrId.id);
  }

  async addToOrganizationUnit(userOrId: IdentityUser | Guid, organizationUnitOrId: OrganizationUnit | Guid): Promise<void> {
    const user = typeof userOrId === "string" ? await this.userRepository.get(userOrId) : userOrId;
    const organizationUnit = typeof organizationUnitOrId === "string" ? await this.organizationUnitRepository.get(organizationUnitOrId) : organizationUnitOrId;
    if (user.organizationUnits.some((cou) => cou.organizationUnitId === organizationUnit.id)) return;
    await this.checkMaxUserOrganizationUnitMembershipCount(user.organizationUnits.length + 1);
    user.addOrganizationUnit(organizationUnit.id);
    await this.userRepository.update(user);
    await this.dynamicClaimCache.remove(AbpDynamicClaimCacheItem.calculateCacheKey(user.id, user.tenantId));
  }

  async removeFromOrganizationUnit(userOrId: IdentityUser | Guid, organizationUnitOrId: OrganizationUnit | Guid): Promise<void> {
    const user = typeof userOrId === "string" ? await this.userRepository.get(userOrId) : userOrId;
    user.removeOrganizationUnit(typeof organizationUnitOrId === "string" ? organizationUnitOrId : organizationUnitOrId.id);
    await this.userRepository.update(user);
    await this.dynamicClaimCache.remove(AbpDynamicClaimCacheItem.calculateCacheKey(user.id, user.tenantId));
  }

  async setOrganizationUnits(userOrId: IdentityUser | Guid, ...organizationUnitIds: Guid[]): Promise<void> {
    const user = typeof userOrId === "string" ? await this.userRepository.get(userOrId) : Check.notNull(userOrId, "user");
    Check.notNull(organizationUnitIds, "organizationUnitIds");
    await this.checkMaxUserOrganizationUnitMembershipCount(organizationUnitIds.length);
    for (const ouId of user.organizationUnits.map((uou) => uou.organizationUnitId)) {
      if (!organizationUnitIds.includes(ouId)) user.removeOrganizationUnit(ouId);
    }
    for (const organizationUnitId of organizationUnitIds) {
      if (!user.isInOrganizationUnit(organizationUnitId)) user.addOrganizationUnit(organizationUnitId);
    }
    await this.userRepository.update(user);
  }

  private async checkMaxUserOrganizationUnitMembershipCount(requestedCount: number): Promise<void> {
    const maxCount = await SettingProviderExtensions.getAsNumber(this.settingProvider, IdentitySettingNames.OrganizationUnit.MaxUserMembershipCount, Number.MAX_SAFE_INTEGER);
    if (requestedCount > maxCount) throw new BusinessException({ code: IdentityErrorCodes.MaxAllowedOuMembership }).withData("MaxUserMembershipCount", maxCount);
  }

  async getOrganizationUnits(user: IdentityUser, includeDetails = false): Promise<OrganizationUnit[]> {
    return this.organizationUnitRepository.getListByIds(user.organizationUnits.map((t) => t.organizationUnitId), includeDetails);
  }

  async getUsersInOrganizationUnit(organizationUnit: OrganizationUnit, includeChildren = false): Promise<IdentityUser[]> {
    if (includeChildren) return this.userRepository.getUsersInOrganizationUnitWithChildren(organizationUnit.code);
    return this.userRepository.getUsersInOrganizationUnit(organizationUnit.id);
  }

  /* ----- user name helpers ----- */

  /** Port of `ValidateUserNameAsync`: allowed characters and uniqueness (ignoring `userId`). */
  async validateUserName(userName: string, userId?: Guid): Promise<boolean> {
    if (isNullOrWhiteSpace(userName)) return false;
    const allowed = (await this.getOptions()).user.allowedUserNameCharacters;
    if (!isNullOrEmptyString(allowed) && [...userName].some((c) => !allowed.includes(c))) return false;
    const owner = await this.findByName(userName);
    return owner === undefined || owner.id === userId;
  }

  async getRandomUserName(length: number): Promise<string> {
    let allowed = (await this.getOptions()).user.allowedUserNameCharacters;
    if (isNullOrWhiteSpace(allowed)) allowed = RandomUserNameCharacters;
    let randomUserName = "";
    while (randomUserName.length < length) randomUserName += allowed[Math.floor(Math.random() * allowed.length)];
    return randomUserName;
  }

  /** Port of `GetUserNameFromEmailAsync`: the local part of the email, made unique with random suffixes when taken. */
  async getUserNameFromEmail(email: string): Promise<string> {
    const maxTryCount = 20;
    const userName = email.split("@")[0]!;
    if (await this.validateUserName(userName)) return userName;

    const allowed = (await this.getOptions()).user.allowedUserNameCharacters;
    const candidates: (() => Promise<string>)[] = [];
    if (isNullOrWhiteSpace(allowed)) candidates.push(async () => userName + String(1000 + Math.floor(Math.random() * 9000)));
    else if (![...userName].every((c) => allowed.includes(c))) candidates.push(() => this.getRandomUserName(userName.length));
    else {
      const allowedDigits = [...new Set([...allowed].filter((c) => c >= "0" && c <= "9"))];
      if (allowedDigits.length >= 4) candidates.push(async () => userName + Array.from({ length: 4 }, () => allowedDigits[Math.floor(Math.random() * allowedDigits.length)]).join(""));
      else candidates.push(async () => userName + (await this.getRandomUserName(4)));
    }
    for (let tryCount = 0; tryCount < maxTryCount; tryCount++) {
      const candidate = await candidates[0]!();
      if (await this.validateUserName(candidate)) return candidate;
    }
    this.logger.error(`Could not get a valid user name for the given email address: ${email}, allowed characters: ${allowed}, tried ${maxTryCount} times.`);
    IdentityResult.failed(this.errorDescriber.invalidUserName(userName)).checkErrors();
    return userName;
  }
}
