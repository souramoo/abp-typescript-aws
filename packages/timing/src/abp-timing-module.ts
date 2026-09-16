import { AbpModule } from "@abp/core";
import "./clock.js";
import "./current-timezone-provider.js";
import "./timezone-provider.js";

/**
 * Port of `AbpTimingModule`. The .NET module depends on localization and settings only to define the
 * `Abp.Timing.TimeZone` setting; that definition moves to the settings layer, so this module has no dependencies.
 */
export class AbpTimingModule extends AbpModule {}
