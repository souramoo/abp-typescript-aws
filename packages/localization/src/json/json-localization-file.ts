/** Port of `JsonLocalizationFile`: ABP's JSON localization format. Nested `texts` are flattened with `__`. */
export interface JsonLocalizationFile {
  culture: string;
  texts: Record<string, JsonLocalizationText>;
}

export type JsonLocalizationText = string | number | boolean | null | JsonLocalizationText[] | { [key: string]: JsonLocalizationText };
