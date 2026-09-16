import { AbpException, IConfiguration, Singleton, Transient, createToken, type ServiceKey } from "@abp/core";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { ICurrentUser } from "@abp/security";
import { ConfigurationSettingValueProvider, DefaultValueSettingValueProvider, GlobalSettingValueProvider, TenantSettingValueProvider, UserSettingValueProvider, type SettingDefinition } from "@abp/settings";
import { ISettingManagementStore } from "./setting-management-store.js";

/** Port of `ISettingManagementProvider`. */
export interface ISettingManagementProvider {
  readonly name: string;
  getOrNull(setting: SettingDefinition, providerKey: string | undefined): Promise<string | undefined>;
  set(setting: SettingDefinition, value: string, providerKey: string | undefined): Promise<void>;
  clear(setting: SettingDefinition, providerKey: string | undefined): Promise<void>;
}
export const ISettingManagementProvider = createToken<ISettingManagementProvider>("ISettingManagementProvider");

/** Port of `SettingManagementProvider`: a provider backed by the `ISettingManagementStore`. Concrete subclasses need their own `@Transient()`. */
export abstract class SettingManagementProvider implements ISettingManagementProvider {
  static readonly inject: readonly ServiceKey[] = [ISettingManagementStore];
  abstract readonly name: string;

  constructor(protected readonly settingManagementStore: ISettingManagementStore) {}

  async getOrNull(setting: SettingDefinition, providerKey: string | undefined): Promise<string | undefined> {
    return this.settingManagementStore.getOrNull(setting.name, this.name, this.normalizeProviderKey(providerKey));
  }

  async set(setting: SettingDefinition, value: string, providerKey: string | undefined): Promise<void> {
    await this.settingManagementStore.set(setting.name, value, this.name, this.normalizeProviderKey(providerKey));
  }

  async clear(setting: SettingDefinition, providerKey: string | undefined): Promise<void> {
    await this.settingManagementStore.delete(setting.name, this.name, this.normalizeProviderKey(providerKey));
  }

  protected normalizeProviderKey(providerKey: string | undefined): string | undefined {
    return providerKey;
  }
}

/** Port of `DefaultValueSettingManagementProvider` ("D"): read-only default values of the definitions. */
@Singleton()
export class DefaultValueSettingManagementProvider implements ISettingManagementProvider {
  readonly name = DefaultValueSettingValueProvider.ProviderName;

  async getOrNull(setting: SettingDefinition): Promise<string | undefined> {
    return setting.defaultValue;
  }

  async set(): Promise<void> {
    throw new AbpException("Can not set default value of a setting. It is only possible while defining the setting in a ISettingDefinitionProvider implementation.");
  }

  async clear(): Promise<void> {
    throw new AbpException("Can not clear default value of a setting. It is only possible while defining the setting in a ISettingDefinitionProvider implementation.");
  }
}

/** Port of `ConfigurationSettingManagementProvider` ("C"): read-only values of `Settings:<name>` in the configuration. */
@Transient()
export class ConfigurationSettingManagementProvider implements ISettingManagementProvider {
  static readonly inject = [IConfiguration] as const;
  readonly name = ConfigurationSettingValueProvider.ProviderName;

  constructor(protected readonly configuration: IConfiguration) {}

  async getOrNull(setting: SettingDefinition): Promise<string | undefined> {
    return this.configuration.get(ConfigurationSettingValueProvider.ConfigurationNamePrefix + setting.name);
  }

  async set(): Promise<void> {
    throw new AbpException("Can not set a setting value to the application configuration.");
  }

  async clear(): Promise<void> {
    throw new AbpException("Can not set a setting value to the application configuration.");
  }
}

/** Port of `GlobalSettingManagementProvider` ("G"): the provider key is always empty. */
@Transient()
export class GlobalSettingManagementProvider extends SettingManagementProvider {
  readonly name = GlobalSettingValueProvider.ProviderName;

  protected override normalizeProviderKey(): string | undefined {
    return undefined;
  }
}

/** Port of `TenantSettingManagementProvider` ("T"): the provider key defaults to the current tenant. */
@Transient()
export class TenantSettingManagementProvider extends SettingManagementProvider {
  static override readonly inject = [ISettingManagementStore, ICurrentTenant] as const;
  readonly name = TenantSettingValueProvider.ProviderName;

  constructor(
    settingManagementStore: ISettingManagementStore,
    protected readonly currentTenant: ICurrentTenant,
  ) {
    super(settingManagementStore);
  }

  protected override normalizeProviderKey(providerKey: string | undefined): string | undefined {
    return providerKey ?? this.currentTenant.id;
  }
}

/** Port of `UserSettingManagementProvider` ("U"): the provider key defaults to the current user. */
@Transient()
export class UserSettingManagementProvider extends SettingManagementProvider {
  static override readonly inject = [ISettingManagementStore, ICurrentUser] as const;
  readonly name = UserSettingValueProvider.ProviderName;

  constructor(
    settingManagementStore: ISettingManagementStore,
    protected readonly currentUser: ICurrentUser,
  ) {
    super(settingManagementStore);
  }

  protected override normalizeProviderKey(providerKey: string | undefined): string | undefined {
    return providerKey ?? this.currentUser.id;
  }
}
