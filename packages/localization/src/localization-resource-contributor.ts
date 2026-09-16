import type { IServiceProvider, LocalizedString } from "@abp/core";
import type { LocalizationResourceBase } from "./localization-resource.js";

/** Port of `LocalizationResourceInitializationContext`. */
export class LocalizationResourceInitializationContext {
  constructor(
    readonly resource: LocalizationResourceBase,
    readonly serviceProvider: IServiceProvider,
  ) {}
}

/** Port of `ILocalizationResourceContributor`. Contributors are value objects owned by a resource, not DI services. */
export interface ILocalizationResourceContributor {
  readonly isDynamic: boolean;
  initialize(context: LocalizationResourceInitializationContext): void;
  getOrNull(cultureName: string, name: string): LocalizedString | undefined;
  fill(cultureName: string, dictionary: Map<string, LocalizedString>): void;
  fillAsync(cultureName: string, dictionary: Map<string, LocalizedString>): Promise<void>;
  getSupportedCulturesAsync(): Promise<string[]>;
}

/** Port of `LocalizationResourceContributorList`. Lookups walk the list in reverse so later contributors win. */
export class LocalizationResourceContributorList implements Iterable<ILocalizationResourceContributor> {
  private readonly items: ILocalizationResourceContributor[] = [];

  get length(): number {
    return this.items.length;
  }

  add(contributor: ILocalizationResourceContributor): void {
    this.items.push(contributor);
  }

  [Symbol.iterator](): Iterator<ILocalizationResourceContributor> {
    return this.items[Symbol.iterator]();
  }

  getOrNull(cultureName: string, name: string, includeDynamicContributors = true): LocalizedString | undefined {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const contributor = this.items[i]!;
      if (!includeDynamicContributors && contributor.isDynamic) continue;
      const found = contributor.getOrNull(cultureName, name);
      if (found) return found;
    }
    return undefined;
  }

  fill(cultureName: string, dictionary: Map<string, LocalizedString>, includeDynamicContributors = true): void {
    for (const contributor of this) {
      if (!includeDynamicContributors && contributor.isDynamic) continue;
      contributor.fill(cultureName, dictionary);
    }
  }

  async fillAsync(cultureName: string, dictionary: Map<string, LocalizedString>, includeDynamicContributors = true): Promise<void> {
    for (const contributor of this) {
      if (!includeDynamicContributors && contributor.isDynamic) continue;
      await contributor.fillAsync(cultureName, dictionary);
    }
  }

  /** Distinct culture names (ABP concatenates the contributors' lists and may repeat a culture). */
  async getSupportedCulturesAsync(): Promise<string[]> {
    const cultures = new Set<string>();
    for (const contributor of this) for (const culture of await contributor.getSupportedCulturesAsync()) cultures.add(culture);
    return [...cultures];
  }
}
