import { AbpModule, DependsOn } from "@abp/core";
import { AbpAspNetCoreAuthenticationJwtBearerModule } from "@abp/auth-jwt";
import { AbpIdentityDomainModule } from "../domain/index.js";
import "./identity-resource-owner-password-validator.js";

/**
 * Port of `AbpIdentityAspNetCoreModule` + `AbpOpenIddictAspNetCoreModule`'s password grant for this runtime: plugs
 * `IdentityResourceOwnerPasswordValidator` into the `@abp/auth-jwt` token endpoint (`POST /connect/token`).
 */
@DependsOn(AbpIdentityDomainModule, AbpAspNetCoreAuthenticationJwtBearerModule)
export class AbpIdentityAuthModule extends AbpModule {}
