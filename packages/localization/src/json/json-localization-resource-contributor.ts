import { AbpException, type LocalizedString } from "@abp/core";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { StaticLocalizationDictionary, type ILocalizationDictionary } from "../localization-dictionary.js";
import type { ILocalizationResourceContributor, LocalizationResourceInitializationContext } from "../localization-resource-contributor.js";
import { JsonLocalizationDictionaryBuilder } from "./json-localization-dictionary-builder.js";

/**
 * Port of `VirtualFileLocalizationResourceContributorBase`: a static contributor whose dictionaries are created
 * once, on first use, from a set of parsed localization files. Files of the same culture are merged in order.
 */
export abstract class StaticLocalizationResourceContributorBase implements ILocalizationResourceContributor {
  readonly isDynamic = false;
  private dictionaries: Map<string, ILocalizationDictionary> | undefined;

  initialize(_context: LocalizationResourceInitializationContext): void {}

  getOrNull(cultureName: string, name: string): LocalizedString | undefined {
    return this.getDictionaries().get(cultureName)?.getOrNull(name);
  }

  fill(cultureName: string, dictionary: Map<string, LocalizedString>): void {
    this.getDictionaries().get(cultureName)?.fill(dictionary);
  }

  async fillAsync(cultureName: string, dictionary: Map<string, LocalizedString>): Promise<void> {
    this.fill(cultureName, dictionary);
  }

  async getSupportedCulturesAsync(): Promise<string[]> {
    return [...this.getDictionaries().keys()];
  }

  protected abstract createSourceDictionaries(): Iterable<ILocalizationDictionary | undefined>;

  private getDictionaries(): Map<string, ILocalizationDictionary> {
    if (this.dictionaries) return this.dictionaries;
    const raw = new Map<string, Map<string, LocalizedString>>();
    for (const dictionary of this.createSourceDictionaries()) {
      if (!dictionary) continue;
      let texts = raw.get(dictionary.cultureName);
      if (!texts) {
        texts = new Map();
        raw.set(dictionary.cultureName, texts);
      }
      dictionary.fill(texts);
    }
    this.dictionaries = new Map([...raw].map(([culture, texts]) => [culture, new StaticLocalizationDictionary(culture, texts)]));
    return this.dictionaries;
  }
}

/** Contributor fed with ABP JSON localization documents given as in-memory objects (typically `import`ed). */
export class JsonObjectLocalizationResourceContributor extends StaticLocalizationResourceContributorBase {
  private readonly documents: readonly unknown[];
  constructor(...documents: unknown[]) {
    super();
    this.documents = documents;
  }

  protected createSourceDictionaries(): Iterable<ILocalizationDictionary | undefined> {
    return this.documents.map((d) => JsonLocalizationDictionaryBuilder.buildFromObject(d));
  }
}

/**
 * Port of `JsonVirtualFileLocalizationResourceContributor` over the real file system: every `*.json` file in
 * the directory is parsed (ordinal file-name order). Unlike the virtual file system, a missing directory is an error.
 */
export class JsonFileLocalizationResourceContributor extends StaticLocalizationResourceContributorBase {
  constructor(readonly directoryPath: string) {
    super();
    if (!existsSync(directoryPath) || !statSync(directoryPath).isDirectory()) {
      throw new AbpException(`Localization directory not found: ${directoryPath}`);
    }
  }

  protected *createSourceDictionaries(): Iterable<ILocalizationDictionary | undefined> {
    const files = readdirSync(this.directoryPath)
      .filter((name) => name.toLowerCase().endsWith(".json"))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const name of files) {
      const path = join(this.directoryPath, name);
      if (!statSync(path).isFile()) continue;
      yield JsonLocalizationDictionaryBuilder.buildFromFile(path);
    }
  }
}
