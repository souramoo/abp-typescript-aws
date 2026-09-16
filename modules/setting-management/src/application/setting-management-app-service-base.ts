import { ApplicationService } from "@abp/ddd-application";
import { AbpSettingManagementResource } from "../domain-shared/index.js";

/**
 * Port of `SettingManagementAppServiceBase`. The .NET base also sets `ObjectMapperContext` to the application
 * module; this module defines no object mappings, so the global mapper is kept.
 */
export abstract class SettingManagementAppServiceBase extends ApplicationService {
  protected constructor() {
    super();
    this.localizationResource = AbpSettingManagementResource;
  }
}
