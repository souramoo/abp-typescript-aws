import { Dependency, ServiceLifetime, createToken, type NameValue } from "@abp/core";

/** Port of `SettingValue` (`NameValue<string?>`). */
export class SettingValue implements NameValue<string | undefined> {
  constructor(
    public name: string,
    public value: string | undefined,
  ) {}
}

/** Port of `ISettingStore`. */
export interface ISettingStore {
  getOrNull(name: string, providerName: string | undefined, providerKey: string | undefined): Promise<string | undefined>;
  getAll(names: readonly string[], providerName: string | undefined, providerKey: string | undefined): Promise<SettingValue[]>;
}
export const ISettingStore = createToken<ISettingStore>("ISettingStore");

/** Port of `NullSettingStore` (`[Dependency(TryRegister = true)]`). */
@Dependency({ lifetime: ServiceLifetime.Singleton, tryRegister: true, exposes: [ISettingStore] })
export class NullSettingStore implements ISettingStore {
  async getOrNull(): Promise<string | undefined> {
    return undefined;
  }

  async getAll(names: readonly string[]): Promise<SettingValue[]> {
    return names.map((name) => new SettingValue(name, undefined));
  }
}
