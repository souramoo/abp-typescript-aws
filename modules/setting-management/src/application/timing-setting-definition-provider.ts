import { LocalizableString, Transient } from "@abp/core";
import { SettingDefinition, SettingDefinitionProvider, type ISettingDefinitionContext } from "@abp/settings";
import { TimingSettingNames } from "@abp/timing";
import { AbpSettingManagementResource } from "../domain-shared/index.js";

/**
 * Port of `TimingSettingProvider` of `Volo.Abp.Timing`. `@abp/timing` does not define the `Abp.Timing.TimeZone`
 * setting, so the time zone application service defines it here until the framework package does.
 */
@Transient()
export class TimingSettingDefinitionProvider extends SettingDefinitionProvider {
  define(context: ISettingDefinitionContext): void {
    if (context.getOrNull(TimingSettingNames.TimeZone)) return;
    context.add(new SettingDefinition(TimingSettingNames.TimeZone, undefined, LocalizableString.create(AbpSettingManagementResource, "DisplayName:Timezone"), undefined, true));
  }
}
