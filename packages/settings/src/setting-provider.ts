import { Check, Transient, createToken } from "@abp/core";
import type { SettingDefinition } from "./setting-definition.js";
import { ISettingDefinitionManager } from "./setting-definition-store.js";
import { ISettingEncryptionService } from "./setting-encryption-service.js";
import { SettingValue } from "./setting-store.js";
import { ISettingValueProviderManager, type ISettingValueProvider } from "./setting-value-provider.js";

/** Port of `ISettingProvider`. */
export interface ISettingProvider {
  getOrNull(name: string): Promise<string | undefined>;
  /** `GetAllAsync(names)`; without `names` returns every defined setting (`GetAllAsync()`). */
  getAll(names?: readonly string[]): Promise<SettingValue[]>;
}
export const ISettingProvider = createToken<ISettingProvider>("ISettingProvider");

/**
 * Port of `SettingProvider`. Value providers are consulted from the last registered to the first (user, tenant,
 * global, configuration, default). ABP leaves `IsInherited` as a TODO; here a non-inherited setting takes its value
 * from the most specific allowed provider only and falls back to `defaultValue` instead of the parent scopes.
 */
@Transient(ISettingProvider)
export class SettingProvider implements ISettingProvider {
  static readonly inject = [ISettingDefinitionManager, ISettingEncryptionService, ISettingValueProviderManager] as const;

  constructor(
    protected readonly settingDefinitionManager: ISettingDefinitionManager,
    protected readonly settingEncryptionService: ISettingEncryptionService,
    protected readonly settingValueProviderManager: ISettingValueProviderManager,
  ) {}

  async getOrNull(name: string): Promise<string | undefined> {
    const setting = await this.settingDefinitionManager.getOrNull(Check.notNull(name, "name"));
    if (!setting) return undefined;

    const providers = this.reversedProviders().filter((p) => isAllowed(setting, p));
    let value = await this.getOrNullValueFromProviders(providers, setting);
    if (value !== undefined && setting.isEncrypted) value = this.settingEncryptionService.decrypt(setting, value);
    return value;
  }

  async getAll(names?: readonly string[]): Promise<SettingValue[]> {
    if (names === undefined) {
      const values: SettingValue[] = [];
      for (const setting of await this.settingDefinitionManager.getAll()) values.push(new SettingValue(setting.name, await this.getOrNull(setting.name)));
      return values;
    }

    const definitions = (await this.settingDefinitionManager.getAll()).filter((x) => names.includes(x.name));
    const result = new Map(definitions.map((d) => [d.name, new SettingValue(d.name, undefined)]));
    let pending = [...definitions];

    for (const provider of this.reversedProviders()) {
      const applicable = pending.filter((d) => isAllowed(d, provider));
      if (applicable.length === 0) continue;
      const found = new Set<string>();
      for (const settingValue of await provider.getAll(applicable)) {
        if (settingValue.value === undefined || settingValue.value === null) continue;
        const definition = applicable.find((d) => d.name === settingValue.name);
        if (!definition) continue;
        result.get(definition.name)!.value = definition.isEncrypted ? this.settingEncryptionService.decrypt(definition, settingValue.value) : settingValue.value;
        found.add(definition.name);
      }
      for (const definition of applicable) {
        if (found.has(definition.name) || definition.isInherited) continue;
        result.get(definition.name)!.value = definition.defaultValue;
        found.add(definition.name);
      }
      pending = pending.filter((d) => !found.has(d.name));
      if (pending.length === 0) break;
    }

    return [...result.values()];
  }

  protected reversedProviders(): ISettingValueProvider[] {
    return [...this.settingValueProviderManager.providers].reverse();
  }

  protected async getOrNullValueFromProviders(providers: readonly ISettingValueProvider[], setting: SettingDefinition): Promise<string | undefined> {
    for (const provider of providers) {
      const value = await provider.getOrNull(setting);
      if (value !== undefined && value !== null) return value;
      if (!setting.isInherited) return setting.defaultValue;
    }
    return undefined;
  }
}

function isAllowed(setting: SettingDefinition, provider: ISettingValueProvider): boolean {
  return setting.providers.length === 0 || setting.providers.includes(provider.name);
}

/** Port of `SettingProviderExtensions` (`IsTrueAsync`, `GetAsync<T>`) as plain functions. */
export const SettingProviderExtensions = {
  async isTrue(settingProvider: ISettingProvider, name: string): Promise<boolean> {
    return (await settingProvider.getOrNull(Check.notNull(name, "name")))?.toLowerCase() === "true";
  },
  async getAsBoolean(settingProvider: ISettingProvider, name: string, defaultValue = false): Promise<boolean> {
    return SettingProviderExtensions.get(settingProvider, name, defaultValue, parseBoolean);
  },
  async getAsNumber(settingProvider: ISettingProvider, name: string, defaultValue = 0): Promise<number> {
    return SettingProviderExtensions.get(settingProvider, name, defaultValue, parseNumber);
  },
  /** `GetAsync<T>(name, defaultValue)`: `convert` replaces .NET's `value.To<T>()`. */
  async get<T>(settingProvider: ISettingProvider, name: string, defaultValue: T, convert: (value: string) => T): Promise<T> {
    const value = await settingProvider.getOrNull(Check.notNull(name, "name"));
    return value === undefined ? defaultValue : convert(value);
  },
};

function parseBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new TypeError(`'${value}' is not a valid boolean.`);
}

function parseNumber(value: string): number {
  const parsed = Number(value);
  if (value.trim() === "" || Number.isNaN(parsed)) throw new TypeError(`'${value}' is not a valid number.`);
  return parsed;
}
