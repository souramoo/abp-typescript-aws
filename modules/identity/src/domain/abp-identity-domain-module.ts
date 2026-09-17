import { AbpModule, DependsOn, type ServiceConfigurationContext } from "@abp/core";
import { AbpCachingModule } from "@abp/caching";
import { AbpDddDomainModule, AbpDistributedEntityEventOptions } from "@abp/ddd-domain";
import { AbpObjectMappingModule, AbpObjectMappingOptions } from "@abp/object-mapping";
import { AbpPermissionManagementDomainModule } from "@abp/permission-management/domain";
import { AbpClaimTypes, AbpClaimsPrincipalFactoryOptions, AbpSecurityModule } from "@abp/security";
import { AbpSettingsModule } from "@abp/settings";
import { UserEto } from "@abp/users/domain-shared";
import { AbpUsersDomainModule } from "@abp/users/domain";
import { AbpIdentityDomainSharedModule, IdentityClaimTypeEto, IdentityRoleEto, OrganizationUnitEto } from "../domain-shared/index.js";
import { IdentityClaimType } from "./identity-claim-type.js";
import { IdentityDomainMappingProfile } from "./identity-domain-mapping-profile.js";
import { AbpIdentityTokenProviderOptions, IdentityOptions } from "./identity-options.js";
import { IdentityRole } from "./identity-role.js";
import { IdentityUser } from "./identity-user.js";
import { OrganizationUnit } from "./organization-unit.js";
import { addAbpTokenProviders } from "./token-providers.js";
import "./abp-identity-error-describer.js";
import "./abp-identity-setting-definition-provider.js";
import "./abp-user-claims-principal-factory.js";
import "./event-handlers.js";
import "./identity-claim-type-manager.js";
import "./identity-data-seeder.js";
import "./identity-dynamic-claims-principal-contributor.js";
import "./identity-link-user-manager.js";
import "./identity-role-manager.js";
import "./identity-security-log-manager.js";
import "./identity-session-manager.js";
import "./identity-user-delegation-manager.js";
import "./identity-user-manager.js";
import "./identity-user-repository-external-user-lookup-service-provider.js";
import "./organization-unit-manager.js";
import "./password-hasher.js";
import "./user-role-finder.js";
import "./validators.js";

/**
 * Port of `AbpIdentityDomainModule`. `AddAbpIdentity` (ASP.NET Core Identity) becomes the managers of this layer;
 * `AbpPermissionManagementDomainModule` is a dependency because the role deleted/renamed grant handlers of
 * `Volo.Abp.PermissionManagement.Domain.Identity` live here. The object-extending `ModuleExtensionConfigurationHelper`
 * calls of `PostConfigureServices` have no counterpart (extension properties are declared on the entity classes directly).
 */
@DependsOn(AbpDddDomainModule, AbpIdentityDomainSharedModule, AbpUsersDomainModule, AbpObjectMappingModule, AbpCachingModule, AbpSettingsModule, AbpSecurityModule, AbpPermissionManagementDomainModule)
export class AbpIdentityDomainModule extends AbpModule {
  override preConfigureServices(): void {
    this.preConfigure(AbpClaimsPrincipalFactoryOptions, (options) => {
      options.isRemoteRefreshEnabled = false;
    });
  }

  override configureServices(context: ServiceConfigurationContext): void {
    this.configure(AbpObjectMappingOptions, (options) => {
      options.addProfile(IdentityDomainMappingProfile, AbpIdentityDomainModule);
    });

    this.configure(AbpDistributedEntityEventOptions, (options) => {
      options.etoMappings.add(IdentityUser, UserEto, AbpIdentityDomainModule);
      options.etoMappings.add(IdentityClaimType, IdentityClaimTypeEto, AbpIdentityDomainModule);
      options.etoMappings.add(IdentityRole, IdentityRoleEto, AbpIdentityDomainModule);
      options.etoMappings.add(OrganizationUnit, OrganizationUnitEto, AbpIdentityDomainModule);
      options.autoEventSelectors.addEntity(IdentityUser);
      options.autoEventSelectors.addEntity(IdentityRole);
    });

    const tokenProviderOptions = context.services.options.executePreConfiguredActions(AbpIdentityTokenProviderOptions);
    this.configure(IdentityOptions, (options) => {
      options.user.requireUniqueEmail = true;
      options.claimsIdentity.userIdClaimType = AbpClaimTypes.userId;
      options.claimsIdentity.userNameClaimType = AbpClaimTypes.userName;
      options.claimsIdentity.roleClaimType = AbpClaimTypes.role;
      options.claimsIdentity.emailClaimType = AbpClaimTypes.email;
      if (tokenProviderOptions.useAbpTokenProviders) addAbpTokenProviders(options.tokens);
    });
  }
}
