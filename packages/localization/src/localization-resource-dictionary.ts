import { AbpException, Check, type Class } from "@abp/core";
import { getLocalizationResourceName } from "./localization-resource-name.js";
import { LocalizationResource, NonTypedLocalizationResource, type LocalizationResourceBase } from "./localization-resource.js";

/** Port of `LocalizationResourceDictionary` (keyed by resource name, with a secondary index by resource class). */
export class LocalizationResourceDictionary extends Map<string, LocalizationResourceBase> {
  private readonly resourcesByTypes = new Map<Class, LocalizationResourceBase>();

  add(resourceType: Class, defaultCultureName?: string): LocalizationResource;
  add(resourceName: string, defaultCultureName?: string): NonTypedLocalizationResource;
  add(resource: Class | string, defaultCultureName?: string): LocalizationResourceBase {
    if (typeof resource === "string") {
      Check.notNullOrWhiteSpace(resource, "resourceName");
      if (this.has(resource)) throw new AbpException(`This resource is already added before: ${resource}`);
      const nonTyped = new NonTypedLocalizationResource(resource, defaultCultureName);
      this.set(resource, nonTyped);
      return nonTyped;
    }
    const resourceName = getLocalizationResourceName(resource);
    if (this.has(resourceName)) throw new AbpException(`This resource is already added before: ${resource.name}`);
    const typed = new LocalizationResource(resource, defaultCultureName);
    this.set(resourceName, typed);
    this.resourcesByTypes.set(resource, typed);
    return typed;
  }

  getByType(resourceType: Class): LocalizationResourceBase {
    const resource = this.getOrNull(resourceType);
    if (!resource) throw new AbpException(`Can not find a resource with given type: ${resourceType.name}`);
    return resource;
  }

  getByName(resourceName: string): LocalizationResourceBase {
    const resource = this.get(resourceName);
    if (!resource) throw new AbpException(`Can not find a resource with given name: ${resourceName}`);
    return resource;
  }

  getOrNull(resourceType: Class): LocalizationResourceBase | undefined {
    return this.resourcesByTypes.get(resourceType);
  }

  containsResource(resourceType: Class): boolean {
    return this.resourcesByTypes.has(resourceType);
  }
}
