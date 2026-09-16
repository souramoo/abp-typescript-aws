import { IServiceProviderToken, Transient, TypeList, createClassMarker, createToken, optionsToken, type Class, type IOptions, type IServiceProvider, type ServiceKey, type ServiceType } from "@abp/core";
import { AbpClaimTypes } from "./abp-claim-types.js";
import { Claim, ClaimsIdentity, ClaimsPrincipal } from "./claims.js";
import { removeAll } from "./claims-identity-extensions.js";

/** Port of `AbpClaimsPrincipalContributorContext`. */
export class AbpClaimsPrincipalContributorContext {
  constructor(
    public claimsPrincipal: ClaimsPrincipal,
    readonly serviceProvider: IServiceProvider,
  ) {}

  getRequiredService<K extends ServiceKey>(key: K): ServiceType<K> {
    return this.serviceProvider.getRequired(key);
  }
}

/** Port of `IAbpClaimsPrincipalContributor`. Mark implementations with `@AbpClaimsPrincipalContributor()` for auto registration. */
export interface IAbpClaimsPrincipalContributor {
  contribute(context: AbpClaimsPrincipalContributorContext): Promise<void>;
}
export const AbpClaimsPrincipalContributor = createClassMarker("IAbpClaimsPrincipalContributor");

/** Port of `IAbpDynamicClaimsPrincipalContributor`. Mark implementations with `@AbpDynamicClaimsPrincipalContributor()`. */
export interface IAbpDynamicClaimsPrincipalContributor {
  contribute(context: AbpClaimsPrincipalContributorContext): Promise<void>;
}
export const AbpDynamicClaimsPrincipalContributor = createClassMarker("IAbpDynamicClaimsPrincipalContributor");

/** Port of `AbpClaimsPrincipalFactoryOptions`. */
export class AbpClaimsPrincipalFactoryOptions {
  readonly contributors = new TypeList<IAbpClaimsPrincipalContributor>();
  readonly dynamicContributors = new TypeList<IAbpDynamicClaimsPrincipalContributor>();
  readonly dynamicClaims: string[] = [
    AbpClaimTypes.userName,
    AbpClaimTypes.name,
    AbpClaimTypes.surName,
    AbpClaimTypes.role,
    AbpClaimTypes.email,
    AbpClaimTypes.emailVerified,
    AbpClaimTypes.phoneNumber,
    AbpClaimTypes.phoneNumberVerified,
  ];
  isRemoteRefreshEnabled = true;
  remoteRefreshUrl = "/api/account/dynamic-claims/refresh";
  claimsMap = new Map<string, string[]>([
    [AbpClaimTypes.userName, ["preferred_username", "unique_name", "name"]],
    [AbpClaimTypes.name, ["given_name"]],
    [AbpClaimTypes.surName, ["family_name"]],
    [AbpClaimTypes.role, ["role", "roles"]],
    [AbpClaimTypes.email, ["email"]],
  ]);
  isDynamicClaimsEnabled = false;
}

/** Port of `IAbpClaimsPrincipalFactory`. */
export interface IAbpClaimsPrincipalFactory {
  create(existingClaimsPrincipal?: ClaimsPrincipal): Promise<ClaimsPrincipal>;
  createDynamic(existingClaimsPrincipal?: ClaimsPrincipal): Promise<ClaimsPrincipal>;
}
export const IAbpClaimsPrincipalFactory = createToken<IAbpClaimsPrincipalFactory>("IAbpClaimsPrincipalFactory");

@Transient(IAbpClaimsPrincipalFactory)
export class AbpClaimsPrincipalFactory implements IAbpClaimsPrincipalFactory {
  static readonly inject = [IServiceProviderToken, optionsToken(AbpClaimsPrincipalFactoryOptions)] as const;
  static readonly authenticationType = "Abp.Application";
  protected readonly options: AbpClaimsPrincipalFactoryOptions;

  constructor(
    protected readonly serviceProvider: IServiceProvider,
    options: IOptions<AbpClaimsPrincipalFactoryOptions>,
  ) {
    this.options = options.value;
  }

  create(existingClaimsPrincipal?: ClaimsPrincipal): Promise<ClaimsPrincipal> {
    return this.internalCreate(this.options, existingClaimsPrincipal, false);
  }

  createDynamic(existingClaimsPrincipal?: ClaimsPrincipal): Promise<ClaimsPrincipal> {
    return this.internalCreate(this.options, existingClaimsPrincipal, true);
  }

  protected async internalCreate(options: AbpClaimsPrincipalFactoryOptions, existingClaimsPrincipal: ClaimsPrincipal | undefined, isDynamic: boolean): Promise<ClaimsPrincipal> {
    const claimsPrincipal = existingClaimsPrincipal ?? new ClaimsPrincipal(new ClaimsIdentity(AbpClaimsPrincipalFactory.authenticationType, AbpClaimTypes.userName, AbpClaimTypes.role));
    const context = new AbpClaimsPrincipalContributorContext(claimsPrincipal, this.serviceProvider);
    const contributorTypes: Iterable<Class<IAbpClaimsPrincipalContributor | IAbpDynamicClaimsPrincipalContributor>> = isDynamic ? options.dynamicContributors : options.contributors;
    for (const contributorType of contributorTypes) {
      const contributor = this.serviceProvider.getRequired(contributorType);
      await contributor.contribute(context);
    }
    return context.claimsPrincipal;
  }
}

/** Port of `AbpDynamicClaim`. */
export class AbpDynamicClaim {
  constructor(
    public type: string,
    public value: string | undefined,
  ) {}
}

/** Port of `AbpDynamicClaimCacheItem`. */
export class AbpDynamicClaimCacheItem {
  constructor(public claims: AbpDynamicClaim[] = []) {}

  static calculateCacheKey(userId: string, tenantId: string | undefined): string {
    return `${tenantId ?? ""}-${userId}`;
  }
}

/**
 * Port of `AbpDynamicClaimsPrincipalContributorBase`. Subclasses inherit the dynamic-contributor marker but must add
 * their own `@Transient()` (conventional registration is not inherited in this port).
 */
export abstract class AbpDynamicClaimsPrincipalContributorBase implements IAbpDynamicClaimsPrincipalContributor {
  abstract contribute(context: AbpClaimsPrincipalContributorContext): Promise<void>;

  protected async addDynamicClaims(context: AbpClaimsPrincipalContributorContext, identity: ClaimsIdentity, dynamicClaims: AbpDynamicClaim[]): Promise<void> {
    const options = context.getRequiredService(optionsToken(AbpClaimsPrincipalFactoryOptions)).value;
    for (const [target, sources] of options.claimsMap) await this.mapClaim(identity, dynamicClaims, target, ...sources);

    const groups = new Map<string, AbpDynamicClaim[]>();
    for (const claim of dynamicClaims) {
      const group = groups.get(claim.type);
      if (group) group.push(claim);
      else groups.set(claim.type, [claim]);
    }
    for (const [type, claims] of groups) {
      removeAll(identity, type);
      identity.addClaims(claims.filter((c) => c.value !== undefined).map((c) => new Claim(type, c.value!)));
    }
  }

  protected async mapClaim(identity: ClaimsIdentity, dynamicClaims: AbpDynamicClaim[], targetClaimType: string, ...sourceClaimTypes: string[]): Promise<void> {
    const claims = dynamicClaims.filter((c) => sourceClaimTypes.includes(c.type));
    if (claims.length === 0) return;
    for (const claim of claims) dynamicClaims.splice(dynamicClaims.indexOf(claim), 1);
    removeAll(identity, targetClaimType);
    identity.addClaims(claims.filter((c) => c.value !== undefined).map((c) => new Claim(targetClaimType, c.value!)));
  }
}

AbpDynamicClaimsPrincipalContributor.mark(AbpDynamicClaimsPrincipalContributorBase as unknown as Class);
