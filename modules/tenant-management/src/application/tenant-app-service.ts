import { Transient, isNullOrWhiteSpace, type Guid } from "@abp/core";
import { Authorize } from "@abp/authorization";
import { DataSeedContext, IDataSeeder, setConcurrencyStampIfNotNull } from "@abp/data";
import { CrudAppService, PagedResultDto } from "@abp/ddd-application";
import { IDistributedEventBus, ILocalEventBus } from "@abp/event-bus";
import { TenantChangedEvent } from "@abp/multi-tenancy-abstractions";
import { mapExtraPropertiesTo } from "@abp/object-extending";
import type { GetTenantsInput} from "../application-contracts/index.js";
import { ITenantAppService, TenantCreateDto, TenantDto, TenantManagementPermissions, TenantUpdateDto } from "../application-contracts/index.js";
import { AbpTenantManagementResource, TenantCreatedEto } from "../domain-shared/index.js";
import { ITenantManager, ITenantRepository, Tenant } from "../domain/index.js";
import { AbpTenantManagementApplicationModule } from "./abp-tenant-management-application-module.js";

/**
 * Port of `TenantAppService` (+ `TenantManagementAppServiceBase`: the module-bound object mapper and the module's
 * localization resource). `[DisableAuditing]` on the `defaultConnectionString` parameter has no counterpart
 * (TypeScript has no parameter decorators).
 */
@Transient(ITenantAppService)
@Authorize(TenantManagementPermissions.Tenants.Default)
export class TenantAppService extends CrudAppService<Tenant, TenantDto, Guid, GetTenantsInput, TenantCreateDto, TenantUpdateDto> implements ITenantAppService {
  static readonly inject = [ITenantRepository, ITenantManager, IDataSeeder, IDistributedEventBus, ILocalEventBus] as const;

  constructor(
    protected readonly tenantRepository: ITenantRepository,
    protected readonly tenantManager: ITenantManager,
    protected readonly dataSeeder: IDataSeeder,
    protected readonly distributedEventBus: IDistributedEventBus,
    protected readonly localEventBus: ILocalEventBus,
  ) {
    super(tenantRepository, { entity: Tenant, getOutputDto: TenantDto, createInput: TenantCreateDto, updateInput: TenantUpdateDto });
    this.objectMapperContext = AbpTenantManagementApplicationModule;
    this.localizationResource = AbpTenantManagementResource;
  }

  override async get(id: Guid): Promise<TenantDto> {
    return this.mapToGetOutputDto(await this.tenantRepository.get(id));
  }

  override async getList(input: GetTenantsInput): Promise<PagedResultDto<TenantDto>> {
    if (isNullOrWhiteSpace(input.sorting)) input.sorting = "name";

    const count = await this.tenantRepository.getCount(input.filter);
    const list = await this.tenantRepository.getList(input.sorting, input.maxResultCount, input.skipCount, input.filter);

    return new PagedResultDto(count, await this.mapToGetListOutputDtos(list));
  }

  @Authorize(TenantManagementPermissions.Tenants.Create)
  override async create(input: TenantCreateDto): Promise<TenantDto> {
    const tenant = await this.tenantManager.create(input.name);
    mapExtraPropertiesTo(input, tenant);

    await this.tenantRepository.insert(tenant);

    await this.currentUnitOfWork?.saveChanges();

    await this.distributedEventBus.publish(
      new TenantCreatedEto({
        id: tenant.id,
        name: tenant.name,
        properties: { AdminEmail: input.adminEmailAddress, AdminPassword: input.adminPassword },
      }),
    );

    await this.currentTenant.run(tenant.id, tenant.name, () => this.dataSeeder.seed(new DataSeedContext(tenant.id).withProperty("AdminEmail", input.adminEmailAddress).withProperty("AdminPassword", input.adminPassword)));

    return this.mapToGetOutputDto(tenant);
  }

  @Authorize(TenantManagementPermissions.Tenants.Update)
  override async update(id: Guid, input: TenantUpdateDto): Promise<TenantDto> {
    const tenant = await this.tenantRepository.get(id);

    await this.tenantManager.changeName(tenant, input.name);

    setConcurrencyStampIfNotNull(tenant, input.concurrencyStamp);
    mapExtraPropertiesTo(input, tenant);

    await this.tenantRepository.update(tenant);

    return this.mapToGetOutputDto(tenant);
  }

  @Authorize(TenantManagementPermissions.Tenants.Delete)
  override async delete(id: Guid): Promise<void> {
    const tenant = await this.tenantRepository.find(id);
    if (tenant === undefined) return;

    await this.tenantRepository.delete(tenant);
  }

  @Authorize(TenantManagementPermissions.Tenants.ManageConnectionStrings)
  async getDefaultConnectionString(id: Guid): Promise<string | undefined> {
    const tenant = await this.tenantRepository.get(id);
    return tenant.findDefaultConnectionString();
  }

  @Authorize(TenantManagementPermissions.Tenants.ManageConnectionStrings)
  async updateDefaultConnectionString(id: Guid, defaultConnectionString: string): Promise<void> {
    const tenant = await this.tenantRepository.get(id);
    if (tenant.findDefaultConnectionString() !== defaultConnectionString) {
      await this.localEventBus.publish(new TenantChangedEvent(tenant.id, tenant.normalizedName));
    }
    tenant.setDefaultConnectionString(defaultConnectionString);
    await this.tenantRepository.update(tenant);
  }

  @Authorize(TenantManagementPermissions.Tenants.ManageConnectionStrings)
  async deleteDefaultConnectionString(id: Guid): Promise<void> {
    const tenant = await this.tenantRepository.get(id);
    tenant.removeDefaultConnectionString();
    await this.localEventBus.publish(new TenantChangedEvent(tenant.id, tenant.normalizedName));
    await this.tenantRepository.update(tenant);
  }
}
