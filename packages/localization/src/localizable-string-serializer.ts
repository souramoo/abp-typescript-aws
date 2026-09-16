import { AbpException, createToken, FixedLocalizableString, isNullOrWhiteSpace, LocalizableString, optionsToken, Transient, type ILocalizableString, type IOptions } from "@abp/core";
import { AbpLocalizationOptions } from "./abp-localization-options.js";
import { ResourceNameLocalizableString, resourceNameOf } from "./localizable-string-extensions.js";
import { isTypedResource } from "./localization-resource.js";

/** Port of `ILocalizableStringSerializer`: `L:{resourceName},{name}` / `F:{value}` string form. */
export interface ILocalizableStringSerializer {
  serialize(localizableString: ILocalizableString | undefined): string | undefined;
  deserialize(value: string): ILocalizableString;
}
export const ILocalizableStringSerializer = createToken<ILocalizableStringSerializer>("ILocalizableStringSerializer");

@Transient(ILocalizableStringSerializer)
export class LocalizableStringSerializer implements ILocalizableStringSerializer {
  static readonly inject = [optionsToken(AbpLocalizationOptions)] as const;
  protected readonly localizationOptions: AbpLocalizationOptions;

  constructor(localizationOptions: IOptions<AbpLocalizationOptions>) {
    this.localizationOptions = localizationOptions.value;
  }

  serialize(localizableString: ILocalizableString | undefined): string | undefined {
    if (!localizableString) return undefined;
    if (localizableString instanceof LocalizableString) return `L:${resourceNameOf(localizableString)},${localizableString.name}`;
    if (localizableString instanceof ResourceNameLocalizableString) return `L:${localizableString.resourceName ?? ""},${localizableString.name}`;
    if (localizableString instanceof FixedLocalizableString) return `F:${localizableString.value}`;
    throw new AbpException(`Unknown ILocalizableString type: ${localizableString.constructor.name}`);
  }

  /** A `L:` value whose resource is registered by class deserializes to the core `LocalizableString`; otherwise by name. */
  deserialize(value: string): ILocalizableString {
    if (value === null || value === undefined) throw new AbpException("value can not be null!");
    if (isNullOrWhiteSpace(value) || value.length < 3 || value[1] !== ":") return new FixedLocalizableString(value);
    switch (value[0]) {
      case "F":
        return new FixedLocalizableString(value.slice(2));
      case "L": {
        const commaPosition = value.indexOf(",", 2);
        if (commaPosition === -1) throw new AbpException(`Invalid LocalizableString value: ${value}`);
        const resourceName = value.slice(2, commaPosition);
        const name = value.slice(commaPosition + 1);
        if (isNullOrWhiteSpace(name)) throw new AbpException(`Invalid LocalizableString value: ${value}`);
        const resource = this.localizationOptions.resources.get(resourceName);
        if (resource && isTypedResource(resource)) return new LocalizableString(resource.resourceType, name);
        return new ResourceNameLocalizableString(name, resourceName === "" ? undefined : resourceName);
      }
      default:
        return new FixedLocalizableString(value);
    }
  }
}
