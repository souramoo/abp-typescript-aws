import { ApplicationService } from "@abp/ddd-application";
import { IdentityResource } from "../domain-shared/index.js";
import { AbpIdentityApplicationModule } from "./abp-identity-application-module.js";

/** Port of `IdentityAppServiceBase`: `IdentityResource` texts and the identity application object-mapper context. */
export abstract class IdentityAppServiceBase extends ApplicationService {
  protected constructor() {
    super();
    this.objectMapperContext = AbpIdentityApplicationModule;
    this.localizationResource = IdentityResource;
  }
}
