import { AbpException, normalizeLineEndings, type LocalizedString } from "@abp/core";
import { readFileSync } from "node:fs";
import { StaticLocalizationDictionary, type ILocalizationDictionary } from "../localization-dictionary.js";
import type { JsonLocalizationFile, JsonLocalizationText } from "./json-localization-file.js";

/** Port of `JsonLocalizationDictionaryBuilder`. */
export const JsonLocalizationDictionaryBuilder = {
  buildFromFile(filePath: string): ILocalizationDictionary | undefined {
    try {
      return JsonLocalizationDictionaryBuilder.buildFromJsonString(readFileSync(filePath, "utf8"));
    } catch (e) {
      throw new AbpException(`Invalid localization file format: ${filePath}`, { cause: e });
    }
  },

  buildFromJsonString(jsonString: string): ILocalizationDictionary | undefined {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e) {
      throw new AbpException(`Can not parse json string. ${(e as Error).message}`, { cause: e });
    }
    return JsonLocalizationDictionaryBuilder.buildFromObject(parsed);
  },

  buildFromObject(json: unknown): ILocalizationDictionary | undefined {
    const file = toJsonLocalizationFile(json);
    if (!file || !file.culture) return undefined;
    const dictionary = new Map<string, LocalizedString>();
    for (const [key, value] of flattenTexts(file.texts)) {
      if (key === "") throw new AbpException("The key is empty in given json string.");
      dictionary.set(key, { name: key, value: normalizeLineEndings(value), resourceNotFound: false });
    }
    return new StaticLocalizationDictionary(file.culture, dictionary);
  },
};

function toJsonLocalizationFile(json: unknown): JsonLocalizationFile | undefined {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return undefined;
  const record = json as Record<string, unknown>;
  const culture = findCaseInsensitive(record, "culture");
  const texts = findCaseInsensitive(record, "texts");
  if (typeof culture !== "string") return undefined;
  if (texts !== undefined && (typeof texts !== "object" || texts === null || Array.isArray(texts))) {
    throw new AbpException("The 'texts' property of a localization file must be an object.");
  }
  return { culture, texts: (texts ?? {}) as Record<string, JsonLocalizationText> };
}

function findCaseInsensitive(record: Record<string, unknown>, key: string): unknown {
  for (const [k, v] of Object.entries(record)) if (k.toLowerCase() === key) return v;
  return undefined;
}

function* flattenTexts(texts: Record<string, JsonLocalizationText>, prefix = ""): Generator<[string, string]> {
  for (const [key, value] of Object.entries(texts)) {
    const currentKey = prefix === "" ? key : `${prefix}__${key}`;
    yield* flattenValue(value, currentKey);
  }
}

function* flattenValue(value: JsonLocalizationText, key: string): Generator<[string, string]> {
  if (value === null) {
    yield [key, ""];
  } else if (typeof value === "string") {
    yield [key, value];
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield* flattenValue(value[i]!, `${key}__${i}`);
  } else if (typeof value === "object") {
    yield* flattenTexts(value, key);
  } else {
    yield [key, String(value)];
  }
}
