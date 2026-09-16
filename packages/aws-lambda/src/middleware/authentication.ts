import { AbpException, Dependency, IAmbientScopeProvider, Scoped, Singleton, Transient, createToken, optionsToken, type Class, type IOptions, type IServiceProvider } from "@abp/core";
import { ClaimsIdentity, ClaimsPrincipal, CurrentPrincipalAccessorBase, ICurrentPrincipalAccessor } from "@abp/security";
import { IHttpContextAccessor, type AbpHttpContext } from "../http-context.js";
import { AbpMiddlewareBase, type RequestDelegate } from "./pipeline.js";

/** Port of `AuthenticateResult`. */
export type AuthenticateResult = { readonly kind: "success"; readonly principal: ClaimsPrincipal } | { readonly kind: "none" } | { readonly kind: "fail"; readonly error: string; readonly errorDescription?: string; readonly errorUri?: string };

export const AuthenticateResult = {
  success(principal: ClaimsPrincipal): AuthenticateResult {
    return { kind: "success", principal };
  },
  noResult(): AuthenticateResult {
    return { kind: "none" };
  },
  fail(error: string, errorDescription?: string, errorUri?: string): AuthenticateResult {
    return { kind: "fail", error, errorDescription, errorUri };
  },
};

/** Port of `IAuthenticationHandler`: one per scheme, resolved from the request scope. */
export interface IAuthenticationHandler {
  authenticate(context: AbpHttpContext): Promise<AuthenticateResult>;
  /** 401 response decoration (e.g. `WWW-Authenticate`). */
  challenge?(context: AbpHttpContext): Promise<void>;
  /** 403 response decoration. */
  forbid?(context: AbpHttpContext): Promise<void>;
}
export const IAuthenticationHandler = createToken<IAuthenticationHandler>("IAuthenticationHandler");

export interface AuthenticationScheme {
  readonly name: string;
  readonly handlerType: Class<IAuthenticationHandler>;
}

/** Port of `AuthenticationOptions` + `AuthenticationBuilder.AddScheme`. Schemes run in order; the first success wins. */
export class AbpAuthenticationOptions {
  readonly schemes: AuthenticationScheme[] = [];
  /** Scheme used by the authorization exception handler to challenge; defaults to the first scheme. */
  defaultChallengeScheme: string | undefined;

  addScheme(name: string, handlerType: Class<IAuthenticationHandler>): this {
    const existing = this.schemes.findIndex((s) => s.name === name);
    if (existing >= 0) this.schemes[existing] = { name, handlerType };
    else this.schemes.push({ name, handlerType });
    return this;
  }

  removeScheme(name: string): boolean {
    const index = this.schemes.findIndex((s) => s.name === name);
    if (index < 0) return false;
    this.schemes.splice(index, 1);
    return true;
  }
}

export function resolveAuthenticationHandler(provider: IServiceProvider, options: AbpAuthenticationOptions, schemeName: string): IAuthenticationHandler {
  const scheme = options.schemes.find((s) => s.name === schemeName);
  if (!scheme) throw new AbpException(`No authentication scheme named ${schemeName} was found.`);
  return provider.get(scheme.handlerType) ?? new scheme.handlerType();
}

/** The scheme every host has: never authenticates (port of the anonymous identity ASP.NET Core assigns). */
@Transient()
export class AnonymousAuthenticationHandler implements IAuthenticationHandler {
  static readonly SchemeName = "Anonymous";
  async authenticate(): Promise<AuthenticateResult> {
    return AuthenticateResult.noResult();
  }
}

/** Port of `AbpAspNetCoreTokenUnauthorizedErrorInfo`: what a failed token authentication reports on the challenge. */
@Scoped()
export class AbpAspNetCoreTokenUnauthorizedErrorInfo {
  error: string | undefined;
  errorDescription: string | undefined;
  errorUri: string | undefined;
}

export function anonymousPrincipal(): ClaimsPrincipal {
  return new ClaimsPrincipal(new ClaimsIdentity());
}

/**
 * Port of `AuthenticationMiddleware` (+ ABP's `UseJwtTokenMiddleware`): runs the configured schemes, sets
 * `context.user` and makes it the current principal for the rest of the pipeline.
 */
@Transient()
export class AbpAuthenticationMiddleware extends AbpMiddlewareBase {
  static readonly inject = [optionsToken(AbpAuthenticationOptions), ICurrentPrincipalAccessor] as const;
  private readonly options: AbpAuthenticationOptions;

  constructor(
    options: IOptions<AbpAuthenticationOptions>,
    private readonly currentPrincipalAccessor: ICurrentPrincipalAccessor,
  ) {
    super();
    this.options = options.value;
  }

  override async invoke(context: AbpHttpContext, next: RequestDelegate): Promise<void> {
    if (!context.user.isAuthenticated) {
      for (const scheme of this.options.schemes) {
        const handler = context.serviceProvider.get(scheme.handlerType) ?? new scheme.handlerType();
        const result = await handler.authenticate(context);
        if (result.kind === "success") {
          context.user = result.principal;
          break;
        }
        if (result.kind === "fail") {
          const info = context.serviceProvider.get(AbpAspNetCoreTokenUnauthorizedErrorInfo);
          if (info) {
            info.error = result.error;
            info.errorDescription = result.errorDescription;
            info.errorUri = result.errorUri;
          }
        }
      }
    }
    await this.currentPrincipalAccessor.run(context.user, () => next(context));
  }
}

/** Port of `HttpContextCurrentPrincipalAccessor`: the current principal defaults to `HttpContext.User`. */
@Dependency({ replaceServices: true })
@Singleton(ICurrentPrincipalAccessor)
export class HttpContextCurrentPrincipalAccessor extends CurrentPrincipalAccessorBase {
  static readonly inject = [IAmbientScopeProvider, IHttpContextAccessor] as const;

  constructor(
    ambientScopeProvider: IAmbientScopeProvider<ClaimsPrincipal>,
    private readonly httpContextAccessor: IHttpContextAccessor,
  ) {
    super(ambientScopeProvider);
  }

  protected getClaimsPrincipal(): ClaimsPrincipal {
    return this.httpContextAccessor.httpContext?.user ?? anonymousPrincipal();
  }
}
