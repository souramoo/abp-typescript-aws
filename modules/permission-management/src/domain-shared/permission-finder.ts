import { createToken, type Guid } from "@abp/core";
import { z } from "zod";

/** Port of `IsGrantedRequest`. */
export class IsGrantedRequest {
  static readonly schema = z.object({ userId: z.uuid(), permissionNames: z.array(z.string().min(1)) });
  userId!: Guid;
  permissionNames: string[] = [];
}

/** Port of `IsGrantedResponse` (`Permissions` is a plain name → granted object so it serializes like the .NET dictionary). */
export class IsGrantedResponse {
  userId!: Guid;
  permissions: Record<string, boolean> = {};
}

/** Port of `IPermissionFinder`: batch permission checks for other users (used by the integration service). */
export interface IPermissionFinder {
  isGranted(requests: readonly IsGrantedRequest[]): Promise<IsGrantedResponse[]>;
}
export const IPermissionFinder = createToken<IPermissionFinder>("IPermissionFinder");

/** Port of `PermissionFinderExtensions.IsGrantedAsync(userId, permissionName(s))`: true when every named permission is granted to the user. */
export async function isGrantedForUser(permissionFinder: IPermissionFinder, userId: Guid, permissionNames: string | readonly string[]): Promise<boolean> {
  const names = typeof permissionNames === "string" ? [permissionNames] : [...permissionNames];
  const request = new IsGrantedRequest();
  request.userId = userId;
  request.permissionNames = names;
  const responses = await permissionFinder.isGranted([request]);
  return responses.some((r) => r.userId === userId && Object.entries(r.permissions).every(([name, granted]) => names.includes(name) && granted));
}
