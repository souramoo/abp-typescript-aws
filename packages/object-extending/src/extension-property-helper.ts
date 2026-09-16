import { Guid } from "@abp/core";
import { z } from "zod";

/**
 * Port of `ExtensionPropertyHelper`. A property type is either a zod schema or one of the primitive kinds below.
 * Non-nullable .NET primitives (`int`, `bool`, `Guid`) get `[Required]` by default; `string` and dates are nullable.
 */
export type ExtensionPropertyPrimitiveKind = "string" | "number" | "boolean" | "date" | "guid";
export type ExtensionPropertyType = z.ZodType | ExtensionPropertyPrimitiveKind;

const primitiveSchemas: Record<ExtensionPropertyPrimitiveKind, z.ZodType> = {
  string: z.string().nullish(),
  number: z.number(),
  boolean: z.boolean(),
  date: z.union([z.date(), z.iso.datetime({ offset: true })]).nullish(),
  guid: z.uuid(),
};

/** Port of `TypeHelper.GetDefaultValue(Type)` for the primitive kinds. */
const primitiveDefaults: Record<ExtensionPropertyPrimitiveKind, unknown> = {
  string: undefined,
  number: 0,
  boolean: false,
  date: undefined,
  guid: Guid.empty,
};

export const ExtensionPropertyHelper = {
  toSchema(type: ExtensionPropertyType): z.ZodType {
    return typeof type === "string" ? primitiveSchemas[type] : type;
  },

  /** The type's own default: the primitive default, or what the zod schema yields for `undefined` (`.default(x)`). */
  getTypeDefaultValue(type: ExtensionPropertyType): unknown {
    if (typeof type === "string") return primitiveDefaults[type];
    const result = type.safeParse(undefined);
    return result.success ? result.data : undefined;
  },

  getDefaultValue(type: ExtensionPropertyType, defaultValueFactory: (() => unknown) | undefined, defaultValue: unknown): unknown {
    if (defaultValueFactory) return defaultValueFactory();
    return defaultValue ?? ExtensionPropertyHelper.getTypeDefaultValue(type);
  },
};
