import { ApplicationService } from "@abp/ddd-application";
import { AbpFeatureManagementResource } from "../domain-shared/index.js";

/**
 * Port of `FeatureManagementAppServiceBase`. The .NET base also sets `ObjectMapperContext` to the application
 * module; this module defines no object mappings, so the global mapper is kept.
 */
export abstract class FeatureManagementAppServiceBase extends ApplicationService {
  protected constructor() {
    super();
    this.localizationResource = AbpFeatureManagementResource;
  }
}
