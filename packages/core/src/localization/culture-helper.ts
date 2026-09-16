import { AmbientScopeProvider } from "../threading/ambient-scope-provider.js";

/** Port of `CultureHelper`: ambient current culture (`CultureInfo.CurrentCulture`) and UI culture. */
const provider = new AmbientScopeProvider<string>();
const CULTURE_KEY = "Abp.Culture";
const UI_CULTURE_KEY = "Abp.UICulture";

export interface CultureHelperType {
  defaultCulture: string;
  readonly currentCulture: string;
  readonly currentUICulture: string;
  use(culture: string, uiCulture?: string): Disposable;
  run<R>(culture: string, fn: () => R, uiCulture?: string): R;
  isRtl(culture?: string): boolean;
  isValidCultureCode(code: string): boolean;
  getBaseCultureName(culture: string): string;
}

export const CultureHelper: CultureHelperType = {
  defaultCulture: "en",
  get currentCulture(): string {
    return provider.getValue(CULTURE_KEY) ?? CultureHelper.defaultCulture;
  },
  get currentUICulture(): string {
    return provider.getValue(UI_CULTURE_KEY) ?? provider.getValue(CULTURE_KEY) ?? CultureHelper.defaultCulture;
  },
  /** `using (CultureHelper.Use("tr"))` */
  use(culture: string, uiCulture?: string): Disposable {
    const a = provider.beginScope(CULTURE_KEY, culture);
    const b = provider.beginScope(UI_CULTURE_KEY, uiCulture ?? culture);
    return {
      [Symbol.dispose]: () => {
        b[Symbol.dispose]();
        a[Symbol.dispose]();
      },
    };
  },
  run<R>(culture: string, fn: () => R, uiCulture?: string): R {
    return provider.run(CULTURE_KEY, culture, () => provider.run(UI_CULTURE_KEY, uiCulture ?? culture, fn));
  },
  isRtl(culture: string = CultureHelper.currentUICulture): boolean {
    const lang = culture.split("-")[0]?.toLowerCase();
    return ["ar", "he", "fa", "ur", "dv", "ps", "sd", "ug", "yi"].includes(lang ?? "");
  },
  isValidCultureCode(code: string): boolean {
    try {
      return Intl.getCanonicalLocales(code).length > 0;
    } catch {
      return false;
    }
  },
  /** `"en-GB"` → `"en"`. */
  getBaseCultureName(culture: string): string {
    return culture.split("-")[0] ?? culture;
  },
};
