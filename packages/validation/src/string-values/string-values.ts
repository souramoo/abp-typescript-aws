import { Check } from "@abp/core";

/** Port of `Volo.Abp.Validation.StringValues` (used by settings and features). `[ValueValidator("X")]` becomes `name`. */
export interface IValueValidator {
  readonly name: string;
  readonly properties: Map<string, unknown>;
  isValid(value: unknown): boolean;
}

export abstract class ValueValidatorBase implements IValueValidator {
  abstract readonly name: string;
  readonly properties = new Map<string, unknown>();

  get(key: string): unknown {
    return this.properties.get(key);
  }

  set(key: string, value: unknown): void {
    this.properties.set(key, value);
  }

  abstract isValid(value: unknown): boolean;
}

export class AlwaysValidValueValidator extends ValueValidatorBase {
  readonly name = "NULL";
  isValid(): boolean {
    return true;
  }
}

export class BooleanValueValidator extends ValueValidatorBase {
  readonly name = "BOOLEAN";
  isValid(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === "boolean") return true;
    const text = String(value).toLowerCase();
    return text === "true" || text === "false";
  }
}

export class NumericValueValidator extends ValueValidatorBase {
  readonly name = "NUMERIC";

  constructor(minValue = Number.MIN_SAFE_INTEGER, maxValue = Number.MAX_SAFE_INTEGER) {
    super();
    this.minValue = minValue;
    this.maxValue = maxValue;
  }

  get minValue(): number {
    return Number(this.get("MinValue") ?? 0);
  }
  set minValue(value: number) {
    this.set("MinValue", value);
  }
  get maxValue(): number {
    return Number(this.get("MaxValue") ?? 0);
  }
  set maxValue(value: number) {
    this.set("MaxValue", value);
  }

  isValid(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === "number") return Number.isInteger(value) && this.isValidInternal(value);
    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return this.isValidInternal(Number(value));
    return false;
  }

  protected isValidInternal(value: number): boolean {
    return value >= this.minValue && value <= this.maxValue;
  }
}

export class StringValueValidator extends ValueValidatorBase {
  readonly name = "STRING";

  constructor(minLength = 0, maxLength = 0, regularExpression?: string, allowNull = false) {
    super();
    this.minLength = minLength;
    this.maxLength = maxLength;
    this.regularExpression = regularExpression;
    this.allowNull = allowNull;
  }

  get allowNull(): boolean {
    return String(this.get("AllowNull") ?? "false") === "true";
  }
  set allowNull(value: boolean) {
    this.set("AllowNull", String(value));
  }
  get minLength(): number {
    return Number(this.get("MinLength") ?? 0);
  }
  set minLength(value: number) {
    this.set("MinLength", value);
  }
  get maxLength(): number {
    return Number(this.get("MaxLength") ?? 0);
  }
  set maxLength(value: number) {
    this.set("MaxLength", value);
  }
  get regularExpression(): string | undefined {
    const value = this.get("RegularExpression");
    return typeof value === "string" ? value : undefined;
  }
  set regularExpression(value: string | undefined) {
    this.set("RegularExpression", value);
  }

  isValid(value: unknown): boolean {
    if (value === null || value === undefined) return this.allowNull;
    if (typeof value !== "string") return false;
    if (this.minLength > 0 && value.length < this.minLength) return false;
    if (this.maxLength > 0 && value.length > this.maxLength) return false;
    const pattern = this.regularExpression;
    if (pattern) return new RegExp(pattern).test(value);
    return true;
  }
}

/** Port of `LocalizableStringInfo`. */
export class LocalizableStringInfo {
  constructor(
    readonly resourceName: string,
    readonly name: string,
  ) {}
}

export interface ISelectionStringValueItem {
  value: string;
  displayText: LocalizableStringInfo;
}

export class LocalizableSelectionStringValueItem implements ISelectionStringValueItem {
  constructor(
    public value: string,
    public displayText: LocalizableStringInfo,
  ) {}
}

export interface ISelectionStringValueItemSource {
  readonly items: ISelectionStringValueItem[];
}

export class StaticSelectionStringValueItemSource implements ISelectionStringValueItemSource {
  readonly items: ISelectionStringValueItem[];
  constructor(...items: ISelectionStringValueItem[]) {
    this.items = [...Check.notNullOrEmptyArray(items, "items")];
  }
}

/** Port of `IStringValueType`. `[StringValueType("X")]` becomes `name`. */
export interface IStringValueType {
  readonly name: string;
  readonly properties: Map<string, unknown>;
  validator: IValueValidator;
}

export abstract class StringValueTypeBase implements IStringValueType {
  abstract readonly name: string;
  readonly properties = new Map<string, unknown>();
  validator: IValueValidator;

  protected constructor(validator: IValueValidator = new AlwaysValidValueValidator()) {
    this.validator = validator;
  }

  get(key: string): unknown {
    return this.properties.get(key);
  }

  set(key: string, value: unknown): void {
    this.properties.set(key, value);
  }
}

export class FreeTextStringValueType extends StringValueTypeBase {
  readonly name = "FREE_TEXT";
  constructor(validator?: IValueValidator) {
    super(validator);
  }
}

export class ToggleStringValueType extends StringValueTypeBase {
  readonly name = "TOGGLE";
  constructor(validator: IValueValidator = new BooleanValueValidator()) {
    super(validator);
  }
}

export class SelectionStringValueType extends StringValueTypeBase {
  readonly name = "SELECTION";
  itemSource!: ISelectionStringValueItemSource;
  constructor(validator?: IValueValidator) {
    super(validator);
  }
}
