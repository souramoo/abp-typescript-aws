import { AbpModule } from "@abp/core";
import "./sequential-guid-generator.js";

/** Port of `AbpGuidsModule`: importing it registers `SequentialGuidGenerator` as `IGuidGenerator` (transient). */
export class AbpGuidsModule extends AbpModule {}
