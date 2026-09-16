import { BusinessException, Guid, Transient, type IServiceProvider } from "@abp/core";
import { BasicTenantInfo, ITenantConfigurationProvider, ITenantNormalizer, ITenantResolveResultAccessor, ITenantResolver, ITenantStore, type TenantConfiguration } from "@abp/multi-tenancy-abstractions";

/** Error codes thrown by `TenantConfigurationProvider` (same values as .NET ABP). */
export const AbpMultiTenancyErrorCodes = {
  TenantNotFound: "Volo.AbpIo.MultiTenancy:010001",
  TenantNotActive: "Volo.AbpIo.MultiTenancy:010002",
} as const;

/** Port of `TenantConfigurationProvider`. */
@Transient(ITenantConfigurationProvider)
export class TenantConfigurationProvider implements ITenantConfigurationProvider {
  static readonly inject = [ITenantResolver, ITenantStore, ITenantResolveResultAccessor, ITenantNormalizer] as const;

  constructor(
    protected readonly tenantResolver: ITenantResolver,
    protected readonly tenantStore: ITenantStore,
    protected readonly tenantResolveResultAccessor: ITenantResolveResultAccessor,
    protected readonly tenantNormalizer: ITenantNormalizer,
  ) {}

  async get(saveResolveResult = false): Promise<TenantConfiguration | undefined> {
    const resolveResult = await this.tenantResolver.resolveTenantIdOrName();
    if (saveResolveResult) this.tenantResolveResultAccessor.result = resolveResult;

    if (resolveResult.tenantIdOrName === undefined) return undefined;

    const tenant = await this.findTenant(resolveResult.tenantIdOrName);
    if (!tenant) {
      throw new BusinessException({
        code: AbpMultiTenancyErrorCodes.TenantNotFound,
        message: "Tenant not found!",
        details: `There is no tenant with the tenant id or name: ${resolveResult.tenantIdOrName}`,
      });
    }
    if (!tenant.isActive) {
      throw new BusinessException({
        code: AbpMultiTenancyErrorCodes.TenantNotActive,
        message: "Tenant is not active!",
        details: `The tenant is not active with the tenant id or name: ${resolveResult.tenantIdOrName}`,
      });
    }
    return tenant;
  }

  protected findTenant(tenantIdOrName: string): Promise<TenantConfiguration | undefined> {
    if (Guid.isValid(tenantIdOrName)) return this.tenantStore.findById(Guid.parse(tenantIdOrName));
    return this.tenantStore.findByName(this.tenantNormalizer.normalizeName(tenantIdOrName)!);
  }
}

/**
 * The tenant-resolution half of `MultiTenancyMiddleware`, reusable by HTTP adapters: resolves the current
 * tenant (saving the resolve result) and returns it, or undefined for the host. Adapters then wrap the
 * request in `ICurrentTenant.run(tenant?.tenantId, tenant?.name, next)`.
 */
export async function resolveCurrentTenant(serviceProvider: IServiceProvider): Promise<BasicTenantInfo | undefined> {
  const tenant = await serviceProvider.getRequired(ITenantConfigurationProvider).get(true);
  return tenant ? new BasicTenantInfo(tenant.id, tenant.name) : undefined;
}
