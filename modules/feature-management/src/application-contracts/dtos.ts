import { z } from "zod";
import type { StringValueTypeJson } from "../domain-shared/index.js";

/** Port of `FeatureProviderDto`. */
export class FeatureProviderDto {
  name: string | undefined = undefined;
  key: string | undefined = undefined;
}

/** Port of `FeatureDto`. `valueType` is the JSON form of the `IStringValueType` (what the .NET converter writes). */
export class FeatureDto {
  name = "";
  displayName: string | undefined = undefined;
  value: string | undefined = undefined;
  provider: FeatureProviderDto | undefined = undefined;
  description: string | undefined = undefined;
  valueType: StringValueTypeJson | undefined = undefined;
  depth = 0;
  parentName: string | undefined = undefined;
}

/** Port of `FeatureGroupDto`. */
export class FeatureGroupDto {
  name = "";
  displayName: string | undefined = undefined;
  features: FeatureDto[] = [];

  getNormalizedGroupName(): string {
    return this.name.replace(/\./g, "_");
  }
}

/** Port of `GetFeatureListResultDto`. */
export class GetFeatureListResultDto {
  groups: FeatureGroupDto[] = [];
}

/** Port of `UpdateFeatureDto`. */
export class UpdateFeatureDto {
  static readonly schema = z.object({ name: z.string().min(1), value: z.string().nullish() });
  name = "";
  value: string | null | undefined = undefined;
}

/** Port of `UpdateFeaturesDto`. */
export class UpdateFeaturesDto {
  static readonly schema = z.object({ features: z.array(UpdateFeatureDto.schema).default([]) });
  features: UpdateFeatureDto[] = [];
}
