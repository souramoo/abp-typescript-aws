import { CultureHelper, Transient, createToken } from "@abp/core";
import { IGuidGenerator } from "@abp/guids";
import { ILocalizableStringSerializer } from "@abp/localization";
import type { SettingDefinition } from "@abp/settings";
import { SettingDefinitionRecord } from "./setting-definition-record.js";

/** Port of `ISettingDefinitionSerializer`. */
export interface ISettingDefinitionSerializer {
  serialize(setting: SettingDefinition): Promise<SettingDefinitionRecord>;
  serializeMany(settings: Iterable<SettingDefinition>): Promise<SettingDefinitionRecord[]>;
}
export const ISettingDefinitionSerializer = createToken<ISettingDefinitionSerializer>("ISettingDefinitionSerializer");

/** Port of `SettingDefinitionSerializer`: turns definitions into records (localizable strings in their `L:`/`F:` form). */
@Transient(ISettingDefinitionSerializer)
export class SettingDefinitionSerializer implements ISettingDefinitionSerializer {
  static readonly inject = [IGuidGenerator, ILocalizableStringSerializer] as const;

  constructor(
    protected readonly guidGenerator: IGuidGenerator,
    protected readonly localizableStringSerializer: ILocalizableStringSerializer,
  ) {}

  async serialize(setting: SettingDefinition): Promise<SettingDefinitionRecord> {
    return CultureHelper.run("en", () => {
      const record = new SettingDefinitionRecord(
        this.guidGenerator.create(),
        setting.name,
        this.localizableStringSerializer.serialize(setting.displayName) ?? setting.name,
        this.localizableStringSerializer.serialize(setting.description),
        setting.defaultValue,
        setting.isVisibleToClients,
        this.serializeProviders(setting.providers),
        setting.isInherited,
        setting.isEncrypted,
      );
      for (const [key, value] of setting.properties) record.extraProperties.set(key, value);
      return record;
    });
  }

  async serializeMany(settings: Iterable<SettingDefinition>): Promise<SettingDefinitionRecord[]> {
    const records: SettingDefinitionRecord[] = [];
    for (const setting of settings) records.push(await this.serialize(setting));
    return records;
  }

  protected serializeProviders(providers: readonly string[]): string | undefined {
    return providers.length > 0 ? providers.join(",") : undefined;
  }
}
