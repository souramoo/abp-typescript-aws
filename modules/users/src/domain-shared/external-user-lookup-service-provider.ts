import { createToken, type Guid } from "@abp/core";
import type { IUserData } from "./user-data.js";

/** Port of `IExternalUserLookupServiceProvider`: an optional service that resolves users from an external system. */
export interface IExternalUserLookupServiceProvider {
  findById(id: Guid, signal?: AbortSignal): Promise<IUserData | undefined>;
  findByUserName(userName: string, signal?: AbortSignal): Promise<IUserData | undefined>;
  search(sorting?: string, filter?: string, maxResultCount?: number, skipCount?: number, signal?: AbortSignal): Promise<IUserData[]>;
  getCount(filter?: string, signal?: AbortSignal): Promise<number>;
}
export const IExternalUserLookupServiceProvider = createToken<IExternalUserLookupServiceProvider>("IExternalUserLookupServiceProvider");
