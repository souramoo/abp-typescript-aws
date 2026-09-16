import { Check, type NameValue } from "@abp/core";

/** Port of `FeatureNameValue`. */
export class FeatureNameValue implements NameValue<string | undefined> {
  constructor(
    public name: string,
    public value: string | undefined,
  ) {}
}

/** Port of `FeatureValueProviderInfo`: which provider (and key) supplied a feature value. */
export class FeatureValueProviderInfo {
  readonly name: string;
  readonly key: string | undefined;

  constructor(name: string, key: string | undefined) {
    this.name = Check.notNull(name, "name");
    this.key = key;
  }
}

/** Port of `FeatureNameValueWithGrantedProvider`. */
export class FeatureNameValueWithGrantedProvider implements NameValue<string | undefined> {
  name: string;
  value: string | undefined;
  provider: FeatureValueProviderInfo | undefined = undefined;

  constructor(name: string, value: string | undefined) {
    this.name = Check.notNull(name, "name");
    this.value = value;
  }
}
