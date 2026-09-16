import { CultureHelper, Transient, isNullOrWhiteSpace, optionsToken, type IOptions } from "@abp/core";
import type { AbpHttpContext } from "../http-context.js";
import { AbpMiddlewareBase, type RequestDelegate } from "./pipeline.js";

/** Port of `RequestCulture`. */
export interface RequestCulture {
  readonly culture: string;
  readonly uiCulture: string;
  /** Which provider picked the culture (undefined = the default culture was applied). */
  readonly provider: "query" | "cookie" | "header" | "route" | undefined;
}

/** Port of `AbpRequestLocalizationOptions` + the `RequestLocalizationOptions` ABP configures. */
export class AbpRequestLocalizationOptions {
  defaultCulture = "en";
  /** Empty = accept any valid culture code. */
  supportedCultures: string[] = [];
  queryStringKey = "culture";
  uiQueryStringKey = "ui-culture";
  cookieName = ".AspNetCore.Culture";
  acceptLanguageHeaderEnabled = true;
  useRouteBasedCulture = false;
  routeDataStringKey = "culture";
}

/** Port of `AbpRequestCultureCookieHelper`. */
export const AbpRequestCultureCookieHelper = {
  setCultureCookie(context: AbpHttpContext, requestCulture: RequestCulture, cookieName = new AbpRequestLocalizationOptions().cookieName): void {
    context.response.setCookie(cookieName, `c=${requestCulture.culture}|uic=${requestCulture.uiCulture}`, { expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), path: "/" });
  },
};

export const RequestCultureItemName = "__AbpRequestCulture";

/** Reads the `c=en|uic=en` cookie format. */
export function parseCultureCookie(value: string | undefined): { culture: string; uiCulture: string } | undefined {
  if (!value) return undefined;
  let culture: string | undefined;
  let uiCulture: string | undefined;
  for (const part of value.split("|")) {
    const [key, item] = part.split("=");
    if (key === "c") culture = item;
    if (key === "uic") uiCulture = item;
  }
  if (!culture && !uiCulture) return undefined;
  return { culture: culture ?? uiCulture!, uiCulture: uiCulture ?? culture! };
}

/** Port of `AcceptLanguageHeaderRequestCultureProvider`: languages ordered by quality. */
export function parseAcceptLanguage(header: string | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const quality = q ? Number(q.slice(2)) : 1;
      return { tag: (tag ?? "").trim(), quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((x) => x.tag !== "" && x.tag !== "*" && x.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)
    .map((x) => x.tag);
}

/**
 * Port of `AbpRequestLocalizationMiddleware` (query string → cookie → route → Accept-Language → default) using
 * `CultureHelper.run` as the `CultureInfo.CurrentCulture` of the request.
 */
@Transient()
export class AbpRequestLocalizationMiddleware extends AbpMiddlewareBase {
  static readonly inject = [optionsToken(AbpRequestLocalizationOptions)] as const;
  private readonly options: AbpRequestLocalizationOptions;

  constructor(options: IOptions<AbpRequestLocalizationOptions>) {
    super();
    this.options = options.value;
  }

  override async invoke(context: AbpHttpContext, next: RequestDelegate): Promise<void> {
    const requestCulture = this.determineRequestCulture(context);
    context.items.set(RequestCultureItemName, requestCulture);
    await CultureHelper.run(requestCulture.culture, () => next(context), requestCulture.uiCulture);
  }

  protected determineRequestCulture(context: AbpHttpContext): RequestCulture {
    const request = context.request;

    const queryCulture = request.query.get(this.options.queryStringKey) ?? undefined;
    const queryUiCulture = request.query.get(this.options.uiQueryStringKey) ?? undefined;
    const fromQuery = this.select(queryCulture ?? queryUiCulture, queryUiCulture ?? queryCulture, "query");
    if (fromQuery) return fromQuery;

    const cookie = parseCultureCookie(request.cookies.get(this.options.cookieName));
    const fromCookie = cookie ? this.select(cookie.culture, cookie.uiCulture, "cookie") : undefined;
    if (fromCookie) return fromCookie;

    if (this.options.useRouteBasedCulture) {
      const routeCulture = request.routeValues[this.options.routeDataStringKey];
      const fromRoute = this.select(routeCulture, routeCulture, "route");
      if (fromRoute) return fromRoute;
    }

    if (this.options.acceptLanguageHeaderEnabled) {
      for (const language of parseAcceptLanguage(request.headers.get("accept-language"))) {
        const fromHeader = this.select(language, language, "header");
        if (fromHeader) return fromHeader;
      }
    }

    return { culture: this.options.defaultCulture, uiCulture: this.options.defaultCulture, provider: undefined };
  }

  private select(culture: string | undefined, uiCulture: string | undefined, provider: RequestCulture["provider"]): RequestCulture | undefined {
    const c = this.supported(culture);
    const ui = this.supported(uiCulture) ?? c;
    if (!c) return undefined;
    return { culture: c, uiCulture: ui ?? c, provider };
  }

  private supported(culture: string | undefined): string | undefined {
    if (isNullOrWhiteSpace(culture) || !CultureHelper.isValidCultureCode(culture)) return undefined;
    if (this.options.supportedCultures.length === 0) return culture;
    const exact = this.options.supportedCultures.find((s) => s.toLowerCase() === culture.toLowerCase());
    if (exact) return exact;
    const base = CultureHelper.getBaseCultureName(culture);
    return this.options.supportedCultures.find((s) => s.toLowerCase() === base.toLowerCase());
  }
}
