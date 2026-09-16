import { Dependency, ILoggerFactory, LogLevel, Transient, createToken, isNullOrWhiteSpace, type ILogger } from "@abp/core";
import { IHttpContextAccessor } from "./http-context.js";

/** Port of `IWebClientInfoProvider`. */
export interface IWebClientInfoProvider {
  readonly browserInfo: string | undefined;
  readonly clientIpAddress: string | undefined;
  readonly deviceInfo: string | undefined;
}
export const IWebClientInfoProvider = createToken<IWebClientInfoProvider>("IWebClientInfoProvider");

/** Port of `NullWebClientInfoProvider`. */
export class NullWebClientInfoProvider implements IWebClientInfoProvider {
  static readonly instance = new NullWebClientInfoProvider();
  readonly browserInfo = undefined;
  readonly clientIpAddress = undefined;
  readonly deviceInfo = undefined;
}

/**
 * Port of `HttpContextWebClientInfoProvider`. The client IP honours `X-Forwarded-For` (API Gateway passes the
 * source IP separately, which wins). `deviceInfo` is a light user-agent summary (no parser library).
 */
@Dependency({ replaceServices: true })
@Transient(IWebClientInfoProvider)
export class HttpContextWebClientInfoProvider implements IWebClientInfoProvider {
  static readonly inject = [ILoggerFactory, IHttpContextAccessor] as const;
  protected readonly logger: ILogger;

  constructor(
    loggerFactory: ILoggerFactory,
    protected readonly httpContextAccessor: IHttpContextAccessor,
  ) {
    this.logger = loggerFactory.createLogger(HttpContextWebClientInfoProvider.name);
  }

  get browserInfo(): string | undefined {
    return this.getBrowserInfo();
  }

  get clientIpAddress(): string | undefined {
    return this.getClientIpAddress();
  }

  get deviceInfo(): string | undefined {
    return this.getDeviceInfo();
  }

  protected getBrowserInfo(): string | undefined {
    return this.httpContextAccessor.httpContext?.request.userAgent;
  }

  protected getClientIpAddress(): string | undefined {
    try {
      const request = this.httpContextAccessor.httpContext?.request;
      if (!request) return undefined;
      return request.ip ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    } catch (e) {
      this.logger.logException(e, LogLevel.Warning);
      return undefined;
    }
  }

  protected getDeviceInfo(): string | undefined {
    const browserInfo = this.getBrowserInfo();
    if (isNullOrWhiteSpace(browserInfo)) return undefined;
    return summarizeUserAgent(browserInfo);
  }
}

const knownBrowsers: [RegExp, string][] = [
  [/Edg\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/Chrome\//, "Chrome"],
  [/Firefox\//, "Firefox"],
  [/Safari\//, "Safari"],
  [/MSIE|Trident\//, "Internet Explorer"],
  [/curl\//, "curl"],
  [/PostmanRuntime/, "Postman"],
];

const knownPlatforms: [RegExp, string][] = [
  [/Windows/, "Windows"],
  [/Android/, "Android"],
  [/iPhone|iPad|iPod/, "iOS"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Linux/, "Linux"],
];

/** `"<platform> <browser>"` when recognisable, otherwise the raw user agent (port of the parser switch). */
export function summarizeUserAgent(userAgent: string): string {
  const browser = knownBrowsers.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (!browser) return userAgent;
  const platform = knownPlatforms.find(([pattern]) => pattern.test(userAgent))?.[1];
  return platform ? `${platform} ${browser}` : browser;
}
