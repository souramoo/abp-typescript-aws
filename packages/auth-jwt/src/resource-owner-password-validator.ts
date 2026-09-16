import { Dependency, Singleton, createToken, type Guid } from "@abp/core";
import type { AbpHttpContext } from "@abp/aws-lambda";
import type { Claim } from "@abp/security";
import { OpenIddictConstants } from "./abp-jwt-bearer-options.js";

export interface PasswordGrantContext {
  readonly tenantId: Guid | undefined;
  readonly clientId: string | undefined;
  readonly scopes: readonly string[];
  readonly httpContext: AbpHttpContext;
  /** Every raw token request parameter (e.g. `RememberMe`, `TwoFactorCode`). */
  readonly parameters: ReadonlyMap<string, string>;
}

/** Port of the outcome of `TokenController.HandlePasswordAsync`: the principal's claims, or an OAuth error. */
export type ResourceOwnerPasswordValidationResult =
  | { readonly kind: "success"; readonly claims: readonly Claim[] }
  | { readonly kind: "error"; readonly error: string; readonly errorDescription?: string; readonly parameters?: Readonly<Record<string, unknown>> };

/**
 * The identity module implements this (port of `SignInManager.CheckPasswordSignInAsync` + `CreateUserPrincipalAsync`
 * inside `TokenController.Password`). Claims must use `AbpClaimTypes` (`sub`, `preferred_username`, `role`, `tenantid`, …).
 */
export interface IResourceOwnerPasswordValidator {
  validate(userName: string, password: string, context: PasswordGrantContext): Promise<ResourceOwnerPasswordValidationResult>;
}
export const IResourceOwnerPasswordValidator = createToken<IResourceOwnerPasswordValidator>("IResourceOwnerPasswordValidator");

/** Default until an identity module registers a real validator: the password grant is unsupported. */
@Dependency({ tryRegister: true })
@Singleton(IResourceOwnerPasswordValidator)
export class NullResourceOwnerPasswordValidator implements IResourceOwnerPasswordValidator {
  async validate(): Promise<ResourceOwnerPasswordValidationResult> {
    return { kind: "error", error: OpenIddictConstants.Errors.UnsupportedGrantType, errorDescription: "The password grant is not available: no IResourceOwnerPasswordValidator is registered." };
  }
}
