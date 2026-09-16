import { Dependency, ServiceLifetime, createToken } from "@abp/core";
import { MultiplePermissionGrantResult, PermissionGrantResult } from "./permission-grant-result.js";

/** Port of `IPermissionStore`. */
export interface IPermissionStore {
  isGranted(name: string, providerName: string | undefined, providerKey: string | undefined): Promise<boolean>;
  isGrantedMany(names: readonly string[], providerName: string | undefined, providerKey: string | undefined): Promise<MultiplePermissionGrantResult>;
}
export const IPermissionStore = createToken<IPermissionStore>("IPermissionStore");

/** Port of `NullPermissionStore` (registered with try-add semantics so a real store wins regardless of import order). */
@Dependency({ lifetime: ServiceLifetime.Singleton, tryRegister: true, exposes: [IPermissionStore] })
export class NullPermissionStore implements IPermissionStore {
  async isGranted(): Promise<boolean> {
    return false;
  }

  async isGrantedMany(names: readonly string[]): Promise<MultiplePermissionGrantResult> {
    return new MultiplePermissionGrantResult(names, PermissionGrantResult.Prohibited);
  }
}
