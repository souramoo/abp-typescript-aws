import { createToken, Singleton } from "@abp/core";
import type { LocalizationResourceBase } from "../localization-resource.js";

/** Port of `IExternalLocalizationStore`: resources coming from outside the application (e.g. a database). */
export interface IExternalLocalizationStore {
  getResourceOrNull(resourceName: string): LocalizationResourceBase | undefined;
  getResourceOrNullAsync(resourceName: string): Promise<LocalizationResourceBase | undefined>;
  getResourceNamesAsync(): Promise<string[]>;
  getResourcesAsync(): Promise<LocalizationResourceBase[]>;
}
export const IExternalLocalizationStore = createToken<IExternalLocalizationStore>("IExternalLocalizationStore");

@Singleton(IExternalLocalizationStore)
export class NullExternalLocalizationStore implements IExternalLocalizationStore {
  getResourceOrNull(): LocalizationResourceBase | undefined {
    return undefined;
  }
  async getResourceOrNullAsync(): Promise<LocalizationResourceBase | undefined> {
    return undefined;
  }
  async getResourceNamesAsync(): Promise<string[]> {
    return [];
  }
  async getResourcesAsync(): Promise<LocalizationResourceBase[]> {
    return [];
  }
}
