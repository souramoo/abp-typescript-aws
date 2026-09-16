import { createToken, optionsToken, Transient, type IOptions } from "@abp/core";
import { AbpLocalizationOptions } from "./abp-localization-options.js";
import type { LanguageInfo } from "./language-info.js";

/** Port of `ILanguageProvider`. */
export interface ILanguageProvider {
  getLanguagesAsync(): Promise<readonly LanguageInfo[]>;
}
export const ILanguageProvider = createToken<ILanguageProvider>("ILanguageProvider");

/** Port of `DefaultLanguageProvider`: the languages configured in `AbpLocalizationOptions.languages`. */
@Transient(ILanguageProvider)
export class DefaultLanguageProvider implements ILanguageProvider {
  static readonly inject = [optionsToken(AbpLocalizationOptions)] as const;
  protected readonly options: AbpLocalizationOptions;

  constructor(options: IOptions<AbpLocalizationOptions>) {
    this.options = options.value;
  }

  async getLanguagesAsync(): Promise<readonly LanguageInfo[]> {
    return this.options.languages;
  }
}
