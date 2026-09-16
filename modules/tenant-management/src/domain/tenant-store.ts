import { AbpException, Dependency, Guid, Transient, isNullOrWhiteSpace } from "@abp/core";
import { distributedCacheToken, type IDistributedCache } from "@abp/caching";
import { ICurrentTenant, ITenantStore, TenantConfiguration } from "@abp/multi-tenancy-abstractions";
import { objectMapperToken, type IObjectMapper } from "@abp/object-mapping";
import { AbpTenantManagementDomainModule } from "./abp-tenant-management-domain-module.js";
import { Tenant } from "./tenant.js";
import { TenantConfigurationCacheItem } from "./tenant-configuration-cache-item.js";
import { ITenantRepository } from "./tenant-repository.js";

/** Port of `TenantStore`: replaces `DefaultTenantStore` with the repository-backed, cached store. */
@Dependency({ replaceServices: true })
@Transient(ITenantStore)
export class TenantStore implements ITenantStore {
  static readonly inject = [ITenantRepository, objectMapperToken(AbpTenantManagementDomainModule), ICurrentTenant, distributedCacheToken(TenantConfigurationCacheItem)] as const;

  constructor(
    protected readonly tenantRepository: ITenantRepository,
    protected readonly objectMapper: IObjectMapper,
    protected readonly currentTenant: ICurrentTenant,
    protected readonly cache: IDistributedCache<TenantConfigurationCacheItem>,
  ) {}

  async findByName(normalizedName: string): Promise<TenantConfiguration | undefined> {
    return (await this.getCacheItem(undefined, normalizedName)).value;
  }

  async findById(id: Guid): Promise<TenantConfiguration | undefined> {
    return (await this.getCacheItem(id, undefined)).value;
  }

  find(idOrName: string): Promise<TenantConfiguration | undefined> {
    return Guid.isValid(idOrName) ? this.findById(idOrName) : this.findByName(idOrName);
  }

  async getList(includeDetails = false): Promise<readonly TenantConfiguration[]> {
    return this.objectMapper.mapList(Tenant, TenantConfiguration, await this.tenantRepository.getList(includeDetails));
  }

  protected async getCacheItem(id: Guid | undefined, normalizedName: string | undefined): Promise<TenantConfigurationCacheItem> {
    const cacheKey = this.calculateCacheKey(id, normalizedName);

    const cacheItem = await this.cache.get(cacheKey, { considerUow: true });
    if (cacheItem?.value !== undefined) return cacheItem;

    if (id !== undefined) {
      const tenant = await this.currentTenant.run(undefined, undefined, () => this.tenantRepository.find(id));
      return this.setCache(cacheKey, tenant);
    }

    if (!isNullOrWhiteSpace(normalizedName)) {
      const tenant = await this.currentTenant.run(undefined, undefined, () => this.tenantRepository.findByName(normalizedName));
      return this.setCache(cacheKey, tenant);
    }

    throw new AbpException("Both id and normalizedName can't be invalid.");
  }

  protected async setCache(cacheKey: string, tenant: Tenant | undefined): Promise<TenantConfigurationCacheItem> {
    const tenantConfiguration = tenant !== undefined ? this.objectMapper.map(Tenant, TenantConfiguration, tenant) : undefined;
    const cacheItem = new TenantConfigurationCacheItem(tenantConfiguration);
    await this.cache.set(cacheKey, cacheItem, undefined, { considerUow: true });
    return cacheItem;
  }

  protected calculateCacheKey(id: Guid | undefined, normalizedName: string | undefined): string {
    return TenantConfigurationCacheItem.calculateCacheKey(id, normalizedName);
  }
}
