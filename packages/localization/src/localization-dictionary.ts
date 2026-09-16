import type { LocalizedString } from "@abp/core";

/** Port of `ILocalizationDictionary`: the texts of one culture. */
export interface ILocalizationDictionary {
  readonly cultureName: string;
  getOrNull(name: string): LocalizedString | undefined;
  fill(dictionary: Map<string, LocalizedString>): void;
}

/** Port of `StaticLocalizationDictionary`. */
export class StaticLocalizationDictionary implements ILocalizationDictionary {
  constructor(
    readonly cultureName: string,
    protected readonly dictionary: Map<string, LocalizedString>,
  ) {}

  getOrNull(name: string): LocalizedString | undefined {
    return this.dictionary.get(name);
  }

  fill(dictionary: Map<string, LocalizedString>): void {
    for (const [key, value] of this.dictionary) dictionary.set(key, value);
  }
}
