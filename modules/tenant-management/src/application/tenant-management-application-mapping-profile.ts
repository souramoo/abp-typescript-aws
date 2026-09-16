import { MappingProfile } from "@abp/object-mapping";
import { mapExtraPropertiesTo } from "@abp/object-extending";
import { TenantDto } from "../application-contracts/index.js";
import { Tenant } from "../domain/index.js";

/** Port of `AbpTenantManagementApplicationMapperlyMappers` (`Tenant → TenantDto`, extra properties included). */
export class TenantManagementApplicationMappingProfile extends MappingProfile {
  constructor() {
    super();
    this.createMap(Tenant, TenantDto, (tenant) => TenantManagementApplicationMappingProfile.toTenantDto(tenant), (tenant, dto) => {
      dto.id = tenant.id;
      dto.name = tenant.name;
      dto.concurrencyStamp = tenant.concurrencyStamp;
      mapExtraPropertiesTo(tenant, dto);
    });
  }

  static toTenantDto(tenant: Tenant): TenantDto {
    const dto = new TenantDto();
    dto.id = tenant.id;
    dto.name = tenant.name;
    dto.concurrencyStamp = tenant.concurrencyStamp;
    mapExtraPropertiesTo(tenant, dto);
    return dto;
  }
}
