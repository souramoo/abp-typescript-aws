import { addIfNotContains, Check, type Class } from "@abp/core";
import { getInheritedResourceTypes } from "./inherit-resource.js";
import { JsonFileLocalizationResourceContributor, JsonObjectLocalizationResourceContributor } from "./json/json-localization-resource-contributor.js";
import { getLocalizationResourceName } from "./localization-resource-name.js";
import { LocalizationResourceContributorList, type ILocalizationResourceContributor } from "./localization-resource-contributor.js";

/**
 * Port of `LocalizationResourceBase`. The `LocalizationResourceExtensions` extension methods
 * (`AddBaseTypes`, `AddBaseResources`, `AddVirtualJson`) are instance methods here.
 */
export abstract class LocalizationResourceBase {
  readonly resourceName: string;
  readonly baseResourceNames: string[] = [];
  defaultCultureName: string | undefined;
  readonly contributors = new LocalizationResourceContributorList();

  constructor(resourceName: string, defaultCultureName?: string, initialContributor?: ILocalizationResourceContributor) {
    this.resourceName = Check.notNullOrWhiteSpace(resourceName, "resourceName");
    this.defaultCultureName = defaultCultureName;
    if (initialContributor) this.contributors.add(initialContributor);
  }

  addContributor(contributor: ILocalizationResourceContributor): this {
    this.contributors.add(contributor);
    return this;
  }

  /** Texts given as ABP JSON localization documents (`{ culture, texts }`), e.g. imported `en.json` objects. */
  addJson(...documents: unknown[]): this {
    return this.addContributor(new JsonObjectLocalizationResourceContributor(...documents));
  }

  /** Port of `AddVirtualJson`: loads every `*.json` file of a directory of the real file system. */
  addJsonFilesFromDirectory(absolutePath: string): this {
    return this.addContributor(new JsonFileLocalizationResourceContributor(absolutePath));
  }

  addBaseTypes(...types: Class[]): this {
    for (const type of types) addIfNotContains(this.baseResourceNames, getLocalizationResourceName(type));
    return this;
  }

  addBaseResources(...baseResourceNames: string[]): this {
    addIfNotContains(this.baseResourceNames, ...baseResourceNames);
    return this;
  }
}

/** Port of `LocalizationResource`: a resource identified by a class. */
export class LocalizationResource extends LocalizationResourceBase {
  constructor(
    readonly resourceType: Class,
    defaultCultureName?: string,
    initialContributor?: ILocalizationResourceContributor,
  ) {
    super(getLocalizationResourceName(Check.notNull(resourceType, "resourceType")), defaultCultureName, initialContributor);
    this.addBaseTypes(...getInheritedResourceTypes(resourceType));
  }
}

/** Port of `NonTypedLocalizationResource`: a resource identified by name only (e.g. external/dynamic resources). */
export class NonTypedLocalizationResource extends LocalizationResourceBase {}

export function isTypedResource(resource: LocalizationResourceBase): resource is LocalizationResource {
  return resource instanceof LocalizationResource;
}
