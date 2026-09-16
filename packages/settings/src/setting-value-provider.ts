import { AbpException, IConfiguration, IServiceProviderToken, Singleton, Transient, createToken, optionsToken, type IOptions, type IServiceProvider, type ServiceKey } from "@abp/core";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { ICurrentUser } from "@abp/security";
import { AbpSettingOptions } from "./abp-setting-options.js";
import type { SettingDefinition } from "./setting-definition.js";
import { ISettingStore, SettingValue } from "./setting-store.js";

/** Port of `ISettingValueProvider`. */
export interface ISettingValueProvider {
  readonly name: string;
  getOrNull(setting: SettingDefinition): Promise<string | undefined>;
  getAll(settings: readonly SettingDefinition[]): Promise<SettingValue[]>;
}
export const ISettingValueProvider = createToken<ISettingValueProvider>("ISettingValueProvider");

/** Port of `SettingValueProvider`. Concrete subclasses need their own `@Transient()`. */
export abstract class SettingValueProvider implements ISettingValueProvider {
  static readonly inject: readonly ServiceKey[] = [ISettingStore];
  abstract readonly name: string;

  constructor(protected readonly settingStore: ISettingStore) {}

  abstract getOrNull(setting: SettingDefinition): Promise<string | undefined>;
  abstract getAll(settings: readonly SettingDefinition[]): Promise<SettingValue[]>;
}

/** Port of `DefaultValueSettingValueProvider` ("D"). */
@Transient()
export class DefaultValueSettingValueProvider extends SettingValueProvider {
  static readonly ProviderName = "D";
  readonly name = DefaultValueSettingValueProvider.ProviderName;

  async getOrNull(setting: SettingDefinition): Promise<string | undefined> {
    return setting.defaultValue;
  }

  async getAll(settings: readonly SettingDefinition[]): Promise<SettingValue[]> {
    return settings.map((s) => new SettingValue(s.name, s.defaultValue));
  }
}

/** Port of `ConfigurationSettingValueProvider` ("C"): reads `Settings:<name>` from `IConfiguration`. */
@Transient()
export class ConfigurationSettingValueProvider implements ISettingValueProvider {
  static readonly inject = [IConfiguration] as const;
  static readonly ConfigurationNamePrefix = "Settings:";
  static readonly ProviderName = "C";
  readonly name = ConfigurationSettingValueProvider.ProviderName;

  constructor(protected readonly configuration: IConfiguration) {}

  async getOrNull(setting: SettingDefinition): Promise<string | undefined> {
    return this.configuration.get(ConfigurationSettingValueProvider.ConfigurationNamePrefix + setting.name);
  }

  async getAll(settings: readonly SettingDefinition[]): Promise<SettingValue[]> {
    return settings.map((s) => new SettingValue(s.name, this.configuration.get(ConfigurationSettingValueProvider.ConfigurationNamePrefix + s.name)));
  }
}

/** Port of `GlobalSettingValueProvider` ("G"). */
@Transient()
export class GlobalSettingValueProvider extends SettingValueProvider {
  static readonly ProviderName = "G";
  readonly name = GlobalSettingValueProvider.ProviderName;

  getOrNull(setting: SettingDefinition): Promise<string | undefined> {
    return this.settingStore.getOrNull(setting.name, this.name, undefined);
  }

  getAll(settings: readonly SettingDefinition[]): Promise<SettingValue[]> {
    return this.settingStore.getAll(
      settings.map((s) => s.name),
      this.name,
      undefined,
    );
  }
}

/** Port of `TenantSettingValueProvider` ("T") of `Volo.Abp.MultiTenancy`, registered here after "G". */
@Transient()
export class TenantSettingValueProvider extends SettingValueProvider {
  static override readonly inject = [ISettingStore, ICurrentTenant] as const;
  static readonly ProviderName = "T";
  readonly name = TenantSettingValueProvider.ProviderName;

  constructor(
    settingStore: ISettingStore,
    protected readonly currentTenant: ICurrentTenant,
  ) {
    super(settingStore);
  }

  getOrNull(setting: SettingDefinition): Promise<string | undefined> {
    return this.settingStore.getOrNull(setting.name, this.name, this.currentTenant.id);
  }

  getAll(settings: readonly SettingDefinition[]): Promise<SettingValue[]> {
    return this.settingStore.getAll(
      settings.map((s) => s.name),
      this.name,
      this.currentTenant.id,
    );
  }
}

/** Port of `UserSettingValueProvider` ("U"). */
@Transient()
export class UserSettingValueProvider extends SettingValueProvider {
  static override readonly inject = [ISettingStore, ICurrentUser] as const;
  static readonly ProviderName = "U";
  readonly name = UserSettingValueProvider.ProviderName;

  constructor(
    settingStore: ISettingStore,
    protected readonly currentUser: ICurrentUser,
  ) {
    super(settingStore);
  }

  async getOrNull(setting: SettingDefinition): Promise<string | undefined> {
    if (this.currentUser.id === undefined) return undefined;
    return this.settingStore.getOrNull(setting.name, this.name, this.currentUser.id);
  }

  async getAll(settings: readonly SettingDefinition[]): Promise<SettingValue[]> {
    if (this.currentUser.id === undefined) return settings.map((s) => new SettingValue(s.name, undefined));
    return this.settingStore.getAll(
      settings.map((s) => s.name),
      this.name,
      this.currentUser.id,
    );
  }
}

/** Port of `ISettingValueProviderManager`. */
export interface ISettingValueProviderManager {
  /** Providers in registration order; `SettingProvider` consults them in reverse (last registered first). */
  readonly providers: readonly ISettingValueProvider[];
}
export const ISettingValueProviderManager = createToken<ISettingValueProviderManager>("ISettingValueProviderManager");

/** Port of `SettingValueProviderManager`: resolves `AbpSettingOptions.valueProviders` lazily, once. */
@Singleton(ISettingValueProviderManager)
export class SettingValueProviderManager implements ISettingValueProviderManager {
  static readonly inject = [IServiceProviderToken, optionsToken(AbpSettingOptions)] as const;
  protected readonly options: AbpSettingOptions;
  private resolved: ISettingValueProvider[] | undefined;

  constructor(
    protected readonly serviceProvider: IServiceProvider,
    options: IOptions<AbpSettingOptions>,
  ) {
    this.options = options.value;
  }

  get providers(): readonly ISettingValueProvider[] {
    this.resolved ??= this.getProviders();
    return this.resolved;
  }

  protected getProviders(): ISettingValueProvider[] {
    const providers = this.options.valueProviders.toArray().map((type) => this.serviceProvider.getRequired(type));
    const byName = new Map<string, string[]>();
    for (const p of providers) byName.set(p.name, [...(byName.get(p.name) ?? []), p.constructor.name]);
    for (const [name, types] of byName) {
      if (types.length > 1) throw new AbpException(`Duplicate setting value provider name detected: ${name}. Providers:\n${types.join("\n")}`);
    }
    return providers;
  }
}
