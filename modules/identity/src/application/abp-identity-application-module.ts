import { AbpModule, DependsOn } from "@abp/core";
import { AbpDddApplicationModule } from "@abp/ddd-application";
import { AbpObjectMappingOptions } from "@abp/object-mapping";
import { AbpPermissionManagementApplicationModule } from "@abp/permission-management/application";
import { AbpIdentityApplicationContractsModule } from "../application-contracts/index.js";
import { AbpIdentityDomainModule } from "../domain/index.js";
import { IdentityApplicationMappingProfile } from "./identity-application-mapping-profile.js";
import "./identity-user-app-service.js";
import "./identity-role-app-service.js";
import "./identity-user-lookup-app-service.js";
import "./identity-user-integration-service.js";

/** Port of `AbpIdentityApplicationModule` (`AddMapperlyObjectMapper<AbpIdentityApplicationModule>` becomes the mapping profile bound to this module as context). */
@DependsOn(AbpIdentityDomainModule, AbpIdentityApplicationContractsModule, AbpDddApplicationModule, AbpPermissionManagementApplicationModule)
export class AbpIdentityApplicationModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpObjectMappingOptions, (options) => {
      options.addProfile(IdentityApplicationMappingProfile, AbpIdentityApplicationModule);
    });
  }
}
