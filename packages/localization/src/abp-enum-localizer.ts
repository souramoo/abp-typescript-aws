import { createToken, IStringLocalizerFactory, Transient, type IStringLocalizer } from "@abp/core";

/** A TypeScript enum object (string or numeric). */
export type EnumLike = Record<string, string | number>;

/**
 * Port of `IAbpEnumLocalizer`. TypeScript enums carry no runtime name, so the enum name is passed explicitly:
 * `getString("BookType", BookType, BookType.Science)`.
 */
export interface IAbpEnumLocalizer {
  getString(enumName: string, enumType: EnumLike, enumValue: string | number, specifyLocalizers?: readonly (IStringLocalizer | undefined)[]): string;
}
export const IAbpEnumLocalizer = createToken<IAbpEnumLocalizer>("IAbpEnumLocalizer");

/** Reverse lookup of the member name of an enum value (`Enum.GetName`). */
export function getEnumName(enumType: EnumLike, enumValue: string | number): string | undefined {
  for (const [key, value] of Object.entries(enumType)) {
    if (value === enumValue && !(typeof enumValue === "number" && /^\d+$/.test(key))) return key;
  }
  return undefined;
}

@Transient(IAbpEnumLocalizer)
export class AbpEnumLocalizer implements IAbpEnumLocalizer {
  static readonly inject = [IStringLocalizerFactory] as const;
  constructor(protected readonly stringLocalizerFactory: IStringLocalizerFactory) {}

  getString(enumName: string, enumType: EnumLike, enumValue: string | number, specifyLocalizers?: readonly (IStringLocalizer | undefined)[]): string {
    const localizers = specifyLocalizers ?? [this.stringLocalizerFactory.createDefaultOrNull()];
    const memberName = getEnumName(enumType, enumValue) ?? String(enumValue);
    const localized = this.getStringOrNull(localizers, [
      `Enum:${enumName}.${String(enumValue)}`,
      `Enum:${enumName}.${memberName}`,
      `${enumName}.${String(enumValue)}`,
      `${enumName}.${memberName}`,
      memberName,
    ]);
    return localized ?? memberName;
  }

  protected getStringOrNull(localizers: readonly (IStringLocalizer | undefined)[], keys: readonly string[]): string | undefined {
    for (const key of keys) {
      for (const localizer of localizers) {
        if (!localizer) continue;
        const localized = localizer.get(key);
        if (!localized.resourceNotFound) return localized.value;
      }
    }
    return undefined;
  }
}
