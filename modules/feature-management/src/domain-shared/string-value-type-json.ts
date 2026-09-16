import { AbpException, Check } from "@abp/core";
import { AlwaysValidValueValidator, BooleanValueValidator, FreeTextStringValueType, LocalizableSelectionStringValueItem, LocalizableStringInfo, NumericValueValidator, SelectionStringValueType, StaticSelectionStringValueItemSource, StringValueValidator, ToggleStringValueType, type ISelectionStringValueItemSource, type IStringValueType, type IValueValidator } from "@abp/validation";

/** Port of `IValueValidatorFactory`. */
export interface IValueValidatorFactory {
  canCreate(name: string): boolean;
  create(): IValueValidator;
}

/** Port of `ValueValidatorFactory<TValueValidator>`. */
export class ValueValidatorFactory implements IValueValidatorFactory {
  constructor(
    protected readonly name: string,
    protected readonly factory: () => IValueValidator,
  ) {}

  canCreate(name: string): boolean {
    return this.name === name;
  }

  create(): IValueValidator {
    return this.factory();
  }
}

/** Port of `ValueValidatorFactoryOptions`: the validators the JSON converters can revive, by name. */
export class ValueValidatorFactoryOptions {
  readonly valueValidatorFactory = new Set<IValueValidatorFactory>([
    new ValueValidatorFactory("NULL", () => new AlwaysValidValueValidator()),
    new ValueValidatorFactory("BOOLEAN", () => new BooleanValueValidator()),
    new ValueValidatorFactory("NUMERIC", () => new NumericValueValidator()),
    new ValueValidatorFactory("STRING", () => new StringValueValidator()),
  ]);
}

/** The JSON shape of an `IValueValidator` (port of `ValueValidatorJsonConverter`). */
export interface ValueValidatorJson {
  name: string;
  properties: Record<string, unknown>;
}

/** The JSON shape of an `IStringValueType` (port of `StringValueTypeJsonConverter`): `name` is the .NET type name. */
export interface StringValueTypeJson {
  itemSource?: { items: { value: string; displayText: { resourceName: string; name: string } }[] };
  name: string;
  properties: Record<string, unknown>;
  validator: ValueValidatorJson;
}

/** .NET serializes the value type name as the class name (`ToggleStringValueType`), the port names it `TOGGLE`. */
const dotNetTypeNames: Record<string, string> = {
  TOGGLE: "ToggleStringValueType",
  FREE_TEXT: "FreeTextStringValueType",
  SELECTION: "SelectionStringValueType",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function valueValidatorToJson(validator: IValueValidator): ValueValidatorJson {
  return { name: validator.name, properties: Object.fromEntries(validator.properties) };
}

/** Port of `StringValueTypeJsonConverter.Write` (+ `SelectionStringValueItemSourceJsonConverter`). */
export function stringValueTypeToJson(stringValueType: IStringValueType): StringValueTypeJson {
  const json: StringValueTypeJson = {
    name: dotNetTypeNames[stringValueType.name] ?? stringValueType.name,
    properties: Object.fromEntries(stringValueType.properties),
    validator: valueValidatorToJson(stringValueType.validator),
  };
  if (stringValueType instanceof SelectionStringValueType) {
    const items = (stringValueType.itemSource as ISelectionStringValueItemSource | undefined)?.items ?? [];
    return { itemSource: { items: items.map((i) => ({ value: i.value, displayText: { resourceName: i.displayText.resourceName, name: i.displayText.name } })) }, ...json };
  }
  return json;
}

/** Port of `ValueValidatorJsonConverter.Read`. */
export function valueValidatorFromJson(json: unknown, options: ValueValidatorFactoryOptions): IValueValidator {
  if (!isRecord(json) || typeof json["name"] !== "string") throw new AbpException("Can't get the Name property of IValueValidator!");
  const name = json["name"];
  const factory = [...options.valueValidatorFactory].find((f) => f.canCreate(name));
  if (!factory) throw new AbpException(`IValueValidator named ${name} cannot be created!`);
  const validator = factory.create();
  const properties = json["properties"];
  if (isRecord(properties)) for (const [key, value] of Object.entries(properties)) validator.properties.set(key, value);
  return validator;
}

function itemSourceFromJson(json: unknown): ISelectionStringValueItemSource | undefined {
  if (!isRecord(json) || !Array.isArray(json["items"])) return undefined;
  const items = json["items"].filter(isRecord).map((item) => {
    const displayText = isRecord(item["displayText"]) ? item["displayText"] : {};
    return new LocalizableSelectionStringValueItem(String(item["value"] ?? ""), new LocalizableStringInfo(String(displayText["resourceName"] ?? ""), String(displayText["name"] ?? "")));
  });
  return items.length === 0 ? undefined : new StaticSelectionStringValueItemSource(...items);
}

/** Port of `StringValueTypeJsonConverter.Read`; accepts the .NET type names and the port's short names. */
export function stringValueTypeFromJson(json: unknown, options: ValueValidatorFactoryOptions = new ValueValidatorFactoryOptions()): IStringValueType {
  if (!isRecord(json) || typeof json["name"] !== "string") throw new AbpException("Can't get the Name property of IStringValueType!");
  const validator = isRecord(json["validator"]) ? valueValidatorFromJson(json["validator"], options) : undefined;
  let valueType: IStringValueType;
  switch (json["name"]) {
    case "SelectionStringValueType":
    case "SELECTION": {
      const selection = new SelectionStringValueType(validator);
      const itemSource = itemSourceFromJson(json["itemSource"]);
      if (itemSource) selection.itemSource = itemSource;
      valueType = selection;
      break;
    }
    case "FreeTextStringValueType":
    case "FREE_TEXT":
      valueType = new FreeTextStringValueType(validator);
      break;
    case "ToggleStringValueType":
    case "TOGGLE":
      valueType = new ToggleStringValueType(validator);
      break;
    default:
      throw new AbpException(`IStringValueType named ${Check.notNull(json["name"], "name")} was not found!`);
  }
  const properties = json["properties"];
  if (isRecord(properties)) for (const [key, value] of Object.entries(properties)) valueType.properties.set(key, value);
  return valueType;
}
