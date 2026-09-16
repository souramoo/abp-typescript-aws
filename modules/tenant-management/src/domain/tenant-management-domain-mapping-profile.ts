import { ConnectionStrings, TenantConfiguration } from "@abp/multi-tenancy-abstractions";
import { MappingProfile } from "@abp/object-mapping";
import { TenantEto } from "../domain-shared/index.js";
import { Tenant } from "./tenant.js";

/** Port of `AbpTenantManagementDomainMapperlyMappers` (`Tenant → TenantConfiguration`, `Tenant → TenantEto`). */
export class TenantManagementDomainMappingProfile extends MappingProfile {
  constructor() {
    super();
    this.createMap(Tenant, TenantConfiguration, (tenant) => TenantManagementDomainMappingProfile.toTenantConfiguration(tenant), (tenant, destination) => {
      const mapped = TenantManagementDomainMappingProfile.toTenantConfiguration(tenant);
      destination.id = mapped.id;
      destination.name = mapped.name;
      destination.normalizedName = mapped.normalizedName;
      destination.connectionStrings = mapped.connectionStrings;
    });
    this.createMap(Tenant, TenantEto, (tenant) => TenantManagementDomainMappingProfile.toTenantEto(tenant), (tenant, eto) => {
      eto.id = tenant.id;
      eto.name = tenant.name;
      eto.entityVersion = tenant.entityVersion;
    });
  }

  /** `EditionId` and `IsActive` are ignored like the Mapperly mapper (they keep the `TenantConfiguration` defaults). */
  static toTenantConfiguration(tenant: Tenant): TenantConfiguration {
    const configuration = new TenantConfiguration(tenant.id, tenant.name, tenant.normalizedName);
    const connectionStrings = new ConnectionStrings();
    for (const connectionString of tenant.connectionStrings) connectionStrings.set(connectionString.name, connectionString.value);
    configuration.connectionStrings = connectionStrings;
    return configuration;
  }

  static toTenantEto(tenant: Tenant): TenantEto {
    const eto = new TenantEto();
    eto.id = tenant.id;
    eto.name = tenant.name;
    eto.entityVersion = tenant.entityVersion;
    return eto;
  }
}
