import { CultureHelper, Transient, createToken } from "@abp/core";
import type { FeatureDefinition, FeatureGroupDefinition } from "@abp/features";
import { IGuidGenerator } from "@abp/guids";
import { ILocalizableStringSerializer } from "@abp/localization";
import type { IStringValueType } from "@abp/validation";
import { FeatureDefinitionRecord, FeatureGroupDefinitionRecord } from "./feature-definition-records.js";
import { StringValueTypeSerializer } from "./string-value-type-serializer.js";

/** Port of `IFeatureDefinitionSerializer`. */
export interface IFeatureDefinitionSerializer {
  serializeGroups(featureGroups: Iterable<FeatureGroupDefinition>): Promise<[FeatureGroupDefinitionRecord[], FeatureDefinitionRecord[]]>;
  serializeGroup(featureGroup: FeatureGroupDefinition): Promise<FeatureGroupDefinitionRecord>;
  serializeFeature(feature: FeatureDefinition, featureGroup: FeatureGroupDefinition | undefined): Promise<FeatureDefinitionRecord>;
}
export const IFeatureDefinitionSerializer = createToken<IFeatureDefinitionSerializer>("IFeatureDefinitionSerializer");

/** Port of `FeatureDefinitionSerializer`: turns definitions into records (localizable strings in their `L:`/`F:` form). */
@Transient(IFeatureDefinitionSerializer)
export class FeatureDefinitionSerializer implements IFeatureDefinitionSerializer {
  static readonly inject = [IGuidGenerator, ILocalizableStringSerializer, StringValueTypeSerializer] as const;

  constructor(
    protected readonly guidGenerator: IGuidGenerator,
    protected readonly localizableStringSerializer: ILocalizableStringSerializer,
    protected readonly stringValueTypeSerializer: StringValueTypeSerializer,
  ) {}

  async serializeGroups(featureGroups: Iterable<FeatureGroupDefinition>): Promise<[FeatureGroupDefinitionRecord[], FeatureDefinitionRecord[]]> {
    const featureGroupRecords: FeatureGroupDefinitionRecord[] = [];
    const featureRecords: FeatureDefinitionRecord[] = [];
    for (const featureGroup of featureGroups) {
      featureGroupRecords.push(await this.serializeGroup(featureGroup));
      for (const feature of featureGroup.getFeaturesWithChildren()) featureRecords.push(await this.serializeFeature(feature, featureGroup));
    }
    return [featureGroupRecords, featureRecords];
  }

  async serializeGroup(featureGroup: FeatureGroupDefinition): Promise<FeatureGroupDefinitionRecord> {
    return CultureHelper.run("en", () => {
      const record = new FeatureGroupDefinitionRecord(this.guidGenerator.create(), featureGroup.name, this.localizableStringSerializer.serialize(featureGroup.displayName) ?? featureGroup.name);
      for (const [key, value] of featureGroup.properties) record.extraProperties.set(key, value);
      return record;
    });
  }

  async serializeFeature(feature: FeatureDefinition, featureGroup: FeatureGroupDefinition | undefined): Promise<FeatureDefinitionRecord> {
    return CultureHelper.run("en", () => {
      const record = new FeatureDefinitionRecord(
        this.guidGenerator.create(),
        featureGroup?.name ?? "",
        feature.name,
        feature.parent?.name,
        this.localizableStringSerializer.serialize(feature.displayName) ?? feature.name,
        this.localizableStringSerializer.serialize(feature.description),
        feature.defaultValue,
        feature.isVisibleToClients,
        feature.isAvailableToHost,
        this.serializeProviders(feature.allowedProviders),
        this.serializeStringValueType(feature.valueType),
      );
      for (const [key, value] of feature.properties) record.extraProperties.set(key, value);
      return record;
    });
  }

  protected serializeProviders(providers: readonly string[]): string | undefined {
    return providers.length > 0 ? providers.join(",") : undefined;
  }

  protected serializeStringValueType(stringValueType: IStringValueType): string {
    return this.stringValueTypeSerializer.serialize(stringValueType);
  }
}
