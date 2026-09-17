export * from "./localization/identity-resource.js";
export * from "./consts.js";
export * from "./etos.js";
/**
 * `IUserRoleFinder`, `UserFinderResult` and `RoleFinderResult` are declared by `Volo.Abp.Identity.Domain.Shared` in
 * .NET; this port keeps them in `@abp/permission-management/domain-shared` (the consumer of the bridge) and re-exports
 * them here so identity code can import them from the layer .NET declares them in.
 */
export { IUserRoleFinder, type UserFinderResult, type RoleFinderResult } from "@abp/permission-management/domain-shared";
export * from "./abp-identity-domain-shared-module.js";
