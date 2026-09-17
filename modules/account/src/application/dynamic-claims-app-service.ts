import { Transient } from "@abp/core";
import { Authorize } from "@abp/authorization";
import { IdentityAppServiceBase } from "@abp/identity/application";
import { IdentityDynamicClaimsPrincipalContributorCache } from "@abp/identity/domain";
import { IAbpClaimsPrincipalFactory, ICurrentPrincipalAccessor, getId } from "@abp/security";
import { IDynamicClaimsAppService } from "../application-contracts/index.js";

/** Port of `DynamicClaimsAppService`: drops the cached dynamic claims of the current user and rebuilds the principal. */
@Transient(IDynamicClaimsAppService)
@Authorize()
export class DynamicClaimsAppService extends IdentityAppServiceBase implements IDynamicClaimsAppService {
  static readonly inject = [IdentityDynamicClaimsPrincipalContributorCache, IAbpClaimsPrincipalFactory, ICurrentPrincipalAccessor] as const;

  constructor(
    protected readonly identityDynamicClaimsPrincipalContributorCache: IdentityDynamicClaimsPrincipalContributorCache,
    protected readonly abpClaimsPrincipalFactory: IAbpClaimsPrincipalFactory,
    protected readonly principalAccessor: ICurrentPrincipalAccessor,
  ) {
    super();
  }

  async refresh(): Promise<void> {
    await this.identityDynamicClaimsPrincipalContributorCache.clear(getId(this.currentUser), this.currentUser.tenantId);
    await this.abpClaimsPrincipalFactory.createDynamic(this.principalAccessor.principal);
  }
}
