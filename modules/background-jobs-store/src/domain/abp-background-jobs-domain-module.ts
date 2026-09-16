import { AbpModule, DependsOn } from "@abp/core";
import { AbpBackgroundJobsModule } from "@abp/background-jobs";
import { AbpObjectMappingModule, AbpObjectMappingOptions } from "@abp/object-mapping";
import { AbpBackgroundJobsDomainSharedModule } from "../domain-shared/index.js";
import { BackgroundJobsDomainMappingProfile } from "./background-jobs-domain-mapping-profile.js";

/** Port of `AbpBackgroundJobsDomainModule` (`AbpMapperlyModule` becomes the profile bound to this module class). */
@DependsOn(AbpBackgroundJobsDomainSharedModule, AbpBackgroundJobsModule, AbpObjectMappingModule)
export class AbpBackgroundJobsDomainModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpObjectMappingOptions, (options) => {
      options.addProfile(BackgroundJobsDomainMappingProfile, AbpBackgroundJobsDomainModule);
    });
  }
}
