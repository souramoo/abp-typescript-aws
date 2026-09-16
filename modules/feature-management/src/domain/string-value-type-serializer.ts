import { Transient, optionsToken, type IOptions } from "@abp/core";
import type { IStringValueType } from "@abp/validation";
import { ValueValidatorFactoryOptions, stringValueTypeFromJson, stringValueTypeToJson } from "../domain-shared/index.js";

/** Port of `StringValueTypeSerializer`: the JSON form of a feature's `IStringValueType` stored in `FeatureDefinitionRecord.valueType`. */
@Transient()
export class StringValueTypeSerializer {
  static readonly inject = [optionsToken(ValueValidatorFactoryOptions)] as const;
  protected readonly valueValidatorFactoryOptions: ValueValidatorFactoryOptions;

  constructor(valueValidatorFactoryOptions: IOptions<ValueValidatorFactoryOptions>) {
    this.valueValidatorFactoryOptions = valueValidatorFactoryOptions.value;
  }

  serialize(stringValueType: IStringValueType): string {
    return JSON.stringify(stringValueTypeToJson(stringValueType));
  }

  deserialize(value: string): IStringValueType {
    return stringValueTypeFromJson(JSON.parse(value), this.valueValidatorFactoryOptions);
  }
}
