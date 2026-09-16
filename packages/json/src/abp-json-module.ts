import { AbpModule, DependsOn } from "@abp/core";
import { AbpTimingModule } from "@abp/timing";
import { AbpJsonOptions } from "./abp-json-options.js";
import { AbpBigIntConverter, AbpDateTimeConverter, AbpMapConverter, AbpSetConverter } from "./json-converters.js";
import "./abp-json-serializer.js";

/**
 * Port of `AbpJsonModule` + `AbpJsonAbstractionsModule` + `AbpJsonSystemTextJsonModule`. The type-driven .NET
 * converters (string→enum/bool/Guid, object→inferred types) have no counterpart without runtime types.
 */
@DependsOn(AbpTimingModule)
export class AbpJsonModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpJsonOptions, (options) => {
      options.outputConverters.push(AbpDateTimeConverter, new AbpBigIntConverter(), new AbpMapConverter(), new AbpSetConverter());
      options.inputConverters.push(AbpDateTimeConverter);
    });
  }
}
