import { AbpModule, DependsOn, SimpleStateCheckerManager, type Class, type ServiceCollection, type ServiceConfigurationContext } from "@abp/core";
import { AbpExceptionLocalizationOptions, AbpLocalizationModule, AbpLocalizationOptions } from "@abp/localization";
import { AbpMultiTenancyModule } from "@abp/multi-tenancy";
import { AbpMultiTenancyAbstractionsModule } from "@abp/multi-tenancy-abstractions";
import { AbpSecurityModule } from "@abp/security";
import { AuthorizationInterceptorRegistrar } from "./authorization-interceptor.js";
import { AbpAuthorizationResource, abpAuthorizationEn } from "./localization/abp-authorization-resource.js";
import { AbpPermissionOptions } from "./permissions/abp-permission-options.js";
import { IPermissionStateCheckerManager } from "./permissions/permission-checker.js";
import { IPermissionDefinitionProvider } from "./permissions/permission-definition-provider.js";
import { ClientPermissionValueProvider, RolePermissionValueProvider, UserPermissionValueProvider } from "./permissions/permission-value-provider.js";
import { ClientResourcePermissionValueProvider, RoleResourcePermissionValueProvider, UserResourcePermissionValueProvider } from "./permissions/resources/resource-permissions.js";

/** Port of `AbpAuthorizationAbstractionsModule`. */
@DependsOn(AbpMultiTenancyAbstractionsModule)
export class AbpAuthorizationAbstractionsModule extends AbpModule {}

/**
 * Port of `AbpAuthorizationModule`. The `ISimpleStateCheckerManager<PermissionDefinition>` is registered here
 * (ABP registers the open generic in its core); it has no global state checkers.
 */
@DependsOn(AbpAuthorizationAbstractionsModule, AbpSecurityModule, AbpLocalizationModule, AbpMultiTenancyModule)
export class AbpAuthorizationModule extends AbpModule {
  override preConfigureServices(context: ServiceConfigurationContext): void {
    context.services.onRegistered(AuthorizationInterceptorRegistrar.registerIfNeeded);
    autoAddDefinitionProviders(context.services);
  }

  override configureServices(context: ServiceConfigurationContext): void {
    context.services.tryAddTransient(IPermissionStateCheckerManager, { useFactory: (provider) => new SimpleStateCheckerManager(provider) });

    this.configure(AbpPermissionOptions, (options) => {
      options.valueProviders.add(UserPermissionValueProvider);
      options.valueProviders.add(RolePermissionValueProvider);
      options.valueProviders.add(ClientPermissionValueProvider);

      options.resourceValueProviders.add(UserResourcePermissionValueProvider);
      options.resourceValueProviders.add(RoleResourcePermissionValueProvider);
      options.resourceValueProviders.add(ClientResourcePermissionValueProvider);
    });

    this.configure(AbpLocalizationOptions, (options) => {
      options.resources.add(AbpAuthorizationResource, "en").addJson(abpAuthorizationEn);
    });

    this.configure(AbpExceptionLocalizationOptions, (options) => {
      options.mapCodeNamespace("Volo.Authorization", AbpAuthorizationResource);
    });
  }
}

function autoAddDefinitionProviders(services: ServiceCollection): void {
  const definitionProviders: Class<IPermissionDefinitionProvider>[] = [];
  services.onRegistered((context) => {
    if (IPermissionDefinitionProvider.has(context.implementationType)) definitionProviders.push(context.implementationType as Class<IPermissionDefinitionProvider>);
  });
  services.options.configure(AbpPermissionOptions, (options) => {
    options.definitionProviders.addRange(definitionProviders);
  });
}
