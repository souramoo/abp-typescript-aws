import { AbpModule, DependsOn, type Class, type ServiceCollection, type ServiceConfigurationContext } from "@abp/core";
import { AbpDataModule } from "@abp/data";
import { AbpLocalizationModule } from "@abp/localization";
import { AbpMultiTenancyAbstractionsModule } from "@abp/multi-tenancy-abstractions";
import { AbpSecurityModule } from "@abp/security";
import { AbpSettingOptions } from "./abp-setting-options.js";
import { ISettingDefinitionProvider } from "./setting-definition.js";
import { ConfigurationSettingValueProvider, DefaultValueSettingValueProvider, GlobalSettingValueProvider, TenantSettingValueProvider, UserSettingValueProvider } from "./setting-value-provider.js";

/**
 * Port of `AbpSettingsModule`. The tenant value provider that `AbpMultiTenancyModule` inserts in .NET is registered
 * here (after "G"), which is why this module also depends on the multi-tenancy abstractions.
 */
@DependsOn(AbpLocalizationModule, AbpSecurityModule, AbpDataModule, AbpMultiTenancyAbstractionsModule)
export class AbpSettingsModule extends AbpModule {
  override preConfigureServices(context: ServiceConfigurationContext): void {
    autoAddDefinitionProviders(context.services);
  }

  override configureServices(): void {
    this.configure(AbpSettingOptions, (options) => {
      options.valueProviders.add(DefaultValueSettingValueProvider);
      options.valueProviders.add(ConfigurationSettingValueProvider);
      options.valueProviders.add(GlobalSettingValueProvider);
      options.valueProviders.add(TenantSettingValueProvider);
      options.valueProviders.add(UserSettingValueProvider);
    });
  }
}

function autoAddDefinitionProviders(services: ServiceCollection): void {
  const definitionProviders: Class<ISettingDefinitionProvider>[] = [];
  services.onRegistered((context) => {
    if (ISettingDefinitionProvider.has(context.implementationType)) definitionProviders.push(context.implementationType as Class<ISettingDefinitionProvider>);
  });
  services.options.configure(AbpSettingOptions, (options) => {
    options.definitionProviders.addRange(definitionProviders);
  });
}
