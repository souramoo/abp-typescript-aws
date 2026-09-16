import { Transient } from "@abp/core";
import { UserPermissionValueProvider } from "@abp/authorization";
import { IPermissionFinder, IsGrantedResponse, type IsGrantedRequest } from "../domain-shared/index.js";
import { IPermissionManager } from "./permission-manager.js";

/** Port of `PermissionFinder`: checks user permissions through the `PermissionManager` (all management providers). */
@Transient(IPermissionFinder)
export class PermissionFinder implements IPermissionFinder {
  static readonly inject = [IPermissionManager] as const;

  constructor(protected readonly permissionManager: IPermissionManager) {}

  async isGranted(requests: readonly IsGrantedRequest[]): Promise<IsGrantedResponse[]> {
    const result: IsGrantedResponse[] = [];
    for (const item of requests) {
      const response = new IsGrantedResponse();
      response.userId = item.userId;
      const multiple = await this.permissionManager.get(item.permissionNames, UserPermissionValueProvider.ProviderName, item.userId);
      response.permissions = Object.fromEntries(multiple.result.map((x) => [x.name, x.isGranted]));
      result.push(response);
    }
    return result;
  }
}
