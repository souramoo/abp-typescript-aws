import { Dependency, ServiceLifetime, createToken, type NameValue } from "@abp/core";

/** Port of `FeatureValue` (`NameValue`). */
export class FeatureValue implements NameValue<string | undefined> {
  constructor(
    public name: string,
    public value: string | undefined,
  ) {}
}

/** Port of `IFeatureStore`. */
export interface IFeatureStore {
  getOrNull(name: string, providerName: string | undefined, providerKey: string | undefined): Promise<string | undefined>;
}
export const IFeatureStore = createToken<IFeatureStore>("IFeatureStore");

/** Port of `NullFeatureStore` (`[Dependency(TryRegister = true)]`). */
@Dependency({ lifetime: ServiceLifetime.Singleton, tryRegister: true, exposes: [IFeatureStore] })
export class NullFeatureStore implements IFeatureStore {
  async getOrNull(): Promise<string | undefined> {
    return undefined;
  }
}
