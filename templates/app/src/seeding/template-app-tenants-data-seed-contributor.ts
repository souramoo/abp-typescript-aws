import { IConfiguration, Transient, isNullOrWhiteSpace } from "@abp/core";
import { DataSeedContributor, DataSeedContext, IDataSeeder, type IDataSeedContributor } from "@abp/data";
import { IGuidGenerator } from "@abp/guids";
import { bindTenantsFromConfiguration } from "@abp/multi-tenancy";
import { ITenantNormalizer } from "@abp/multi-tenancy-abstractions";
import { ITenantRepository, ITenantValidator, Tenant } from "@abp/tenant-management/domain";
import { IUnitOfWorkManager } from "@abp/uow";

/**
 * Creates the tenants of the `Tenants` configuration section (the section `DefaultTenantStore` reads in a host
 * without the tenant management module) and seeds each of them (admin user, permissions, sample books), so a
 * fresh local database has a tenant to try `__tenant` with. Runs on the host side only.
 */
@Transient()
@DataSeedContributor()
export class TemplateAppTenantsDataSeedContributor implements IDataSeedContributor {
  static readonly inject = [IConfiguration, ITenantRepository, ITenantValidator, ITenantNormalizer, IGuidGenerator, IDataSeeder, IUnitOfWorkManager] as const;

  constructor(
    private readonly configuration: IConfiguration,
    private readonly tenantRepository: ITenantRepository,
    private readonly tenantValidator: ITenantValidator,
    private readonly tenantNormalizer: ITenantNormalizer,
    private readonly guidGenerator: IGuidGenerator,
    private readonly dataSeeder: IDataSeeder,
    private readonly unitOfWorkManager: IUnitOfWorkManager,
  ) {}

  async seed(context: DataSeedContext): Promise<void> {
    if (context.tenantId !== undefined) return;
    const created: Tenant[] = [];
    for (const configured of bindTenantsFromConfiguration(this.configuration)) {
      if (isNullOrWhiteSpace(configured.name)) continue;
      const normalizedName = this.tenantNormalizer.normalizeName(configured.name) ?? configured.name.toUpperCase();
      if (await this.tenantRepository.findByName(normalizedName)) continue;
      const tenant = new Tenant(isNullOrWhiteSpace(configured.id) ? this.guidGenerator.create() : configured.id, configured.name, normalizedName);
      await this.tenantValidator.validate(tenant);
      created.push(await this.tenantRepository.insert(tenant));
    }
    if (created.length === 0) return;

    await this.unitOfWorkManager.current?.saveChanges();
    for (const tenant of created) {
      const tenantContext = new DataSeedContext(tenant.id);
      for (const [key, value] of context.properties) tenantContext.set(key, value);
      await this.dataSeeder.seed(tenantContext);
    }
  }
}
