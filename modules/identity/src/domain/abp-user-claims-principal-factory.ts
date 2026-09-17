import { Transient, isNullOrWhiteSpace, optionsToken, type IOptions } from "@abp/core";
import { AbpClaimTypes, Claim, ClaimsIdentity, ClaimsPrincipal, IAbpClaimsPrincipalFactory, ICurrentPrincipalAccessor, addIfNotContains } from "@abp/security";
import { IdentityOptions } from "./identity-options.js";
import type { IdentityUser } from "./identity-user.js";
import { IdentityUserManager } from "./identity-user-manager.js";

/**
 * Port of `AbpUserClaimsPrincipalFactory` (+ ASP.NET Core's `UserClaimsPrincipalFactory<TUser, TRole>`): builds the
 * principal of a user (id, user name, email, security stamp, roles incl. organization-unit roles, stored claims,
 * tenant, name/surname, phone and e-mail verification) and runs the `IAbpClaimsPrincipalContributor`s on it.
 */
@Transient()
export class AbpUserClaimsPrincipalFactory {
  static readonly AuthenticationType = "Identity.Application";
  static readonly inject = [IdentityUserManager, optionsToken(IdentityOptions), ICurrentPrincipalAccessor, IAbpClaimsPrincipalFactory] as const;
  protected readonly options: IdentityOptions;

  constructor(
    protected readonly userManager: IdentityUserManager,
    options: IOptions<IdentityOptions>,
    protected readonly currentPrincipalAccessor: ICurrentPrincipalAccessor,
    protected readonly abpClaimsPrincipalFactory: IAbpClaimsPrincipalFactory,
  ) {
    this.options = options.value;
  }

  async create(user: IdentityUser): Promise<ClaimsPrincipal> {
    const identity = await this.generateClaims(user);
    const principal = new ClaimsPrincipal(identity);

    if (user.tenantId !== undefined) addIfNotContains(identity, new Claim(AbpClaimTypes.tenantId, user.tenantId));
    if (!isNullOrWhiteSpace(user.name)) addIfNotContains(identity, new Claim(AbpClaimTypes.name, user.name));
    if (!isNullOrWhiteSpace(user.surname)) addIfNotContains(identity, new Claim(AbpClaimTypes.surName, user.surname));
    if (!isNullOrWhiteSpace(user.phoneNumber)) addIfNotContains(identity, new Claim(AbpClaimTypes.phoneNumber, user.phoneNumber));
    addIfNotContains(identity, new Claim(AbpClaimTypes.phoneNumberVerified, user.phoneNumberConfirmed ? "True" : "False"));
    if (!isNullOrWhiteSpace(user.email)) addIfNotContains(identity, new Claim(AbpClaimTypes.email, user.email));
    addIfNotContains(identity, new Claim(AbpClaimTypes.emailVerified, user.emailConfirmed ? "True" : "False"));

    await this.currentPrincipalAccessor.run(identity, () => this.abpClaimsPrincipalFactory.create(principal));
    return principal;
  }

  /** Port of `UserClaimsPrincipalFactory.GenerateClaimsAsync`: id, user name, email, security stamp, roles and user claims. */
  protected async generateClaims(user: IdentityUser): Promise<ClaimsIdentity> {
    const claimsIdentity = this.options.claimsIdentity;
    const identity = new ClaimsIdentity(AbpUserClaimsPrincipalFactory.AuthenticationType, claimsIdentity.userNameClaimType, claimsIdentity.roleClaimType);
    identity.addClaim(new Claim(claimsIdentity.userIdClaimType, user.id));
    identity.addClaim(new Claim(claimsIdentity.userNameClaimType, user.userName));
    if (!isNullOrWhiteSpace(user.email)) identity.addClaim(new Claim(claimsIdentity.emailClaimType, user.email));
    if (!isNullOrWhiteSpace(user.securityStamp)) identity.addClaim(new Claim(claimsIdentity.securityStampClaimType, user.securityStamp));
    for (const roleName of await this.userManager.getRoles(user)) identity.addClaim(new Claim(claimsIdentity.roleClaimType, roleName));
    identity.addClaims(await this.userManager.getClaims(user));
    return identity;
  }
}
