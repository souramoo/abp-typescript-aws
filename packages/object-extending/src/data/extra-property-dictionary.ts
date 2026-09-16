import { Check } from "@abp/core";

/**
 * Port of `ExtraPropertyDictionary` (a `Dictionary<string, object?>`). Serializes to a plain object through
 * `toJSON()` so entities/DTOs round-trip through `JSON.stringify` and DynamoDB marshalling.
 */
export class ExtraPropertyDictionary extends Map<string, unknown> {
  constructor(entries?: Iterable<readonly [string, unknown]> | Record<string, unknown> | null) {
    super(entries === null || entries === undefined ? undefined : isIterable(entries) ? entries : Object.entries(entries));
  }

  static fromObject(source: Record<string, unknown> | null | undefined): ExtraPropertyDictionary {
    return new ExtraPropertyDictionary(source ?? undefined);
  }

  toJSON(): Record<string, unknown> {
    return this.toObject();
  }

  toObject(): Record<string, unknown> {
    return Object.fromEntries(this);
  }

  /** Port of `ExtraPropertyDictionaryExtensions.HasSameItems` (compares the string forms of the values). */
  hasSameItems(otherDictionary: ExtraPropertyDictionary): boolean {
    Check.notNull(otherDictionary, "otherDictionary");
    if (this.size !== otherDictionary.size) return false;
    for (const [key, value] of this) {
      if (!otherDictionary.has(key) || String(value) !== String(otherDictionary.get(key))) return false;
    }
    return true;
  }
}

function isIterable(value: object): value is Iterable<readonly [string, unknown]> {
  return Symbol.iterator in value;
}
