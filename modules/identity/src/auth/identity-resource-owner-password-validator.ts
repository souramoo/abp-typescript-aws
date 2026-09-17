import { Guid, ILoggerFactory, IServiceProviderToken, Transient, isNullOrWhiteSpace, optionsToken, type ILogger, type IOptions, type IServiceProvider } from "@abp/core";
import { AbpOpenIddictErrors, IResourceOwnerPasswordValidator, OpenIddictConstants, type PasswordGrantContext, type ResourceOwnerPasswordValidationResult } from "@abp/auth-jwt";
import { IWebClientInfoProvider } from "@abp/aws-lambda";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { AbpClaimTypes, Claim } from "@abp/security";
import { ValidationHelper } from "@abp/validation";
import { IdentitySecurityLogActionConsts, IdentitySessionDevices } from "../domain-shared/index.js";
import {
  AbpIdentityOptions,
  AbpUserClaimsPrincipalFactory,
  IdentityDynamicClaimsPrincipalContributorCache,
  IdentitySecurityLogContext,
  IdentitySecurityLogManager,
  IdentitySessionManager,
  IdentityUserManager,
  isExternalLoginProviderWithPassword,
  type IdentityUser,
} from "../domain/index.js";

/** Port of `OpenIddictSecurityLogIdentityConsts` / `AbpErrorDescriptionConsts` used by the token endpoint. */
export const OpenIddictSecurityLogIdentityConsts = { OpenIddict: "OpenIddict" } as const;
export const AbpErrorDescriptionConsts = { RequiresTwoFactor: "RequiresTwoFactor", RequiresConfirmUser: "RequiresConfirmUser" } as const;

const InvalidUserNameOrPassword = "Invalid username or password!";

/**
 * Port of `TokenController.HandlePasswordAsync` (`Volo.Abp.OpenIddict.AspNetCore`) as the `@abp/auth-jwt`
 * `IResourceOwnerPasswordValidator`: external login providers, e-mail-as-user-name, lockout, the ABP pre-sign-in
 * checks, security logs and an `IdentitySession` record whose id becomes the `session_id` claim. Two-factor and
 * "change password on next login" flows end with the same `invalid_grant` descriptions as .NET; the interactive
 * continuation parameters (`TwoFactorCode`, `ChangePasswordToken`, …) are reported but not handled.
 */
@Transient(IResourceOwnerPasswordValidator)
export class IdentityResourceOwnerPasswordValidator implements IResourceOwnerPasswordValidator {
  static readonly inject = [IdentityUserManager, AbpUserClaimsPrincipalFactory, IdentitySecurityLogManager, IdentitySessionManager, IdentityDynamicClaimsPrincipalContributorCache, optionsToken(AbpIdentityOptions), IServiceProviderToken, ICurrentTenant, IWebClientInfoProvider, ILoggerFactory] as const;
  protected readonly logger: ILogger;

  constructor(
    protected readonly userManager: IdentityUserManager,
    protected readonly userClaimsPrincipalFactory: AbpUserClaimsPrincipalFactory,
    protected readonly identitySecurityLogManager: IdentitySecurityLogManager,
    protected readonly identitySessionManager: IdentitySessionManager,
    protected readonly dynamicClaimsCache: IdentityDynamicClaimsPrincipalContributorCache,
    protected readonly abpIdentityOptions: IOptions<AbpIdentityOptions>,
    protected readonly serviceProvider: IServiceProvider,
    protected readonly currentTenant: ICurrentTenant,
    protected readonly webClientInfoProvider: IWebClientInfoProvider,
    loggerFactory: ILoggerFactory,
  ) {
    this.logger = loggerFactory.createLogger(IdentityResourceOwnerPasswordValidator.name);
  }

  async validate(userName: string, password: string, context: PasswordGrantContext): Promise<ResourceOwnerPasswordValidationResult> {
    return this.currentTenant.run(context.tenantId, undefined, async () => {
      const resolvedUserName = await this.replaceEmailToUserNameIfNeeded(userName);

      for (const providerInfo of this.abpIdentityOptions.value.externalLoginProviders.values()) {
        const externalLoginProvider = this.serviceProvider.getRequired(providerInfo.type);
        if (!(await externalLoginProvider.tryAuthenticate(resolvedUserName, password))) continue;
        let user = await this.userManager.findSharedUserByName(resolvedUserName);
        if (!user) {
          user = isExternalLoginProviderWithPassword(externalLoginProvider) ? await externalLoginProvider.createUserWithPassword(resolvedUserName, providerInfo.name, password) : await externalLoginProvider.createUser(resolvedUserName, providerInfo.name);
        } else {
          const existing = user;
          await this.currentTenant.run(existing.tenantId, undefined, async () => {
            if (isExternalLoginProviderWithPassword(externalLoginProvider)) await externalLoginProvider.updateUserWithPassword(existing, providerInfo.name, password);
            else await externalLoginProvider.updateUser(existing, providerInfo.name);
          });
        }
        const externalUser = user;
        return this.currentTenant.run(externalUser.tenantId, undefined, () => this.setSuccessResult(externalUser, resolvedUserName, context));
      }

      const user = await this.userManager.findSharedUserByName(resolvedUserName);
      if (!user) {
        this.logger.info(`No user found matching username: ${resolvedUserName}`);
        await this.saveSecurityLog(IdentitySecurityLogActionConsts.loginInvalidUserName, resolvedUserName, context.clientId);
        return { kind: "error", error: OpenIddictConstants.Errors.InvalidGrant, errorDescription: InvalidUserNameOrPassword };
      }

      return this.currentTenant.run(user.tenantId, undefined, async () => {
        const result = await this.userManager.checkPasswordSignIn(user, password, true);
        if (result.succeeded) return this.setSuccessResult(user, resolvedUserName, context);

        await this.saveSecurityLog(toIdentitySecurityLogAction(result), resolvedUserName, context.clientId);
        if (result.isLockedOut) {
          this.logger.info(`Authentication failed for username: ${resolvedUserName}, reason: locked out`);
          return { kind: "error", error: AbpOpenIddictErrors.AccountLocked, errorDescription: "The user account has been locked out due to invalid login attempts. Please wait a while and try again." };
        }
        if (result.isNotAllowed) {
          if (!(await this.userManager.checkPassword(user, password))) {
            this.logger.info(`Authentication failed for username: ${resolvedUserName}, reason: invalid credentials`);
            return { kind: "error", error: OpenIddictConstants.Errors.InvalidGrant, errorDescription: InvalidUserNameOrPassword };
          }
          this.logger.info(`Authentication failed for username: ${resolvedUserName}, reason: not allowed`);
          if (user.shouldChangePasswordOnNextLogin) return this.changePasswordRequired(user, "ShouldChangePasswordOnNextLogin");
          if (await this.userManager.shouldPeriodicallyChangePassword(user)) return this.changePasswordRequired(user, "PeriodicallyChangePassword");
          if (user.isActive) {
            this.logger.info(`${resolvedUserName} needs to confirm email/phone number`);
            return { kind: "error", error: OpenIddictConstants.Errors.InvalidGrant, errorDescription: AbpErrorDescriptionConsts.RequiresConfirmUser, parameters: { userId: user.id.replace(/-/g, ""), email: user.email, phoneNumber: user.phoneNumber ?? "" } };
          }
          return { kind: "error", error: AbpOpenIddictErrors.AccountInactive, errorDescription: "You are not allowed to login! Your account is inactive or needs to confirm your email/phone number." };
        }
        this.logger.info(`Authentication failed for username: ${resolvedUserName}, reason: invalid credentials`);
        return { kind: "error", error: OpenIddictConstants.Errors.InvalidGrant, errorDescription: InvalidUserNameOrPassword };
      });
    });
  }

  /** Port of `ReplaceEmailToUsernameOfInputIfNeeds`. */
  protected async replaceEmailToUserNameIfNeeded(userName: string): Promise<string> {
    if (!ValidationHelper.isValidEmailAddress(userName)) return userName;
    if (await this.userManager.findSharedUserByName(userName)) return userName;
    const userByEmail = await this.userManager.findSharedUserByEmail(userName);
    return userByEmail?.userName ?? userName;
  }

  protected async changePasswordRequired(user: IdentityUser, changePasswordType: "ShouldChangePasswordOnNextLogin" | "PeriodicallyChangePassword"): Promise<ResourceOwnerPasswordValidationResult> {
    await this.saveSecurityLog(IdentitySecurityLogActionConsts.loginNotAllowed, user.userName, undefined);
    const changePasswordToken = await this.userManager.generateUserToken(user, "Default", changePasswordType);
    return { kind: "error", error: OpenIddictConstants.Errors.InvalidGrant, errorDescription: changePasswordType, parameters: { userId: user.id.replace(/-/g, ""), changePasswordToken } };
  }

  /** Port of `SetSuccessResultAsync`: resets the failed count, clears the dynamic claims, builds the principal and records the session. */
  protected async setSuccessResult(user: IdentityUser, userName: string, context: PasswordGrantContext): Promise<ResourceOwnerPasswordValidationResult> {
    if (await this.userManager.getTwoFactorEnabled(user)) {
      const providers = await this.userManager.getValidTwoFactorProviders(user);
      if (providers.length > 0) {
        this.logger.info(`Authentication failed for username: ${userName}, reason: RequiresTwoFactor`);
        await this.saveSecurityLog(IdentitySecurityLogActionConsts.loginRequiresTwoFactor, userName, context.clientId);
        const twoFactorToken = await this.userManager.generateUserToken(user, "Default", "RequiresTwoFactor");
        return { kind: "error", error: OpenIddictConstants.Errors.InvalidGrant, errorDescription: AbpErrorDescriptionConsts.RequiresTwoFactor, parameters: { userId: user.id.replace(/-/g, ""), twoFactorToken } };
      }
    }

    const resetAccessFailedCountResult = await this.userManager.resetAccessFailedCount(user);
    if (!resetAccessFailedCountResult.succeeded) return { kind: "error", error: OpenIddictConstants.Errors.InvalidGrant, errorDescription: InvalidUserNameOrPassword };

    await this.dynamicClaimsCache.clear(user.id, user.tenantId);
    const principal = await this.userClaimsPrincipalFactory.create(user);

    const session = await this.identitySessionManager.create(user, {
      sessionId: Guid.newGuid(),
      device: IdentitySessionDevices.OAuth,
      deviceInfo: this.webClientInfoProvider.deviceInfo ?? this.webClientInfoProvider.browserInfo,
      clientId: context.clientId,
      ipAddresses: isNullOrWhiteSpace(this.webClientInfoProvider.clientIpAddress) ? [] : [this.webClientInfoProvider.clientIpAddress],
    });
    const claims = [...principal.claims.filter((c) => c.type !== AbpClaimTypes.sessionId), new Claim(AbpClaimTypes.sessionId, session.sessionId)];

    await this.saveSecurityLog(IdentitySecurityLogActionConsts.loginSucceeded, userName, context.clientId);
    await this.userManager.updateLastSignInTime(user.id);
    return { kind: "success", claims };
  }

  protected saveSecurityLog(action: string, userName: string, clientId: string | undefined): Promise<void> {
    return this.identitySecurityLogManager.save(new IdentitySecurityLogContext({ identity: OpenIddictSecurityLogIdentityConsts.OpenIddict, action, userName, clientId }));
  }
}

/** Port of `SignInResultExtensions.ToIdentitySecurityLogAction`. */
function toIdentitySecurityLogAction(result: { succeeded: boolean; isLockedOut: boolean; isNotAllowed: boolean; requiresTwoFactor: boolean }): string {
  if (result.succeeded) return IdentitySecurityLogActionConsts.loginSucceeded;
  if (result.isLockedOut) return IdentitySecurityLogActionConsts.loginLockedout;
  if (result.requiresTwoFactor) return IdentitySecurityLogActionConsts.loginRequiresTwoFactor;
  if (result.isNotAllowed) return IdentitySecurityLogActionConsts.loginNotAllowed;
  return IdentitySecurityLogActionConsts.loginFailed;
}
