import { AbpModule, DependsOn, Transient, type ServiceConfigurationContext } from "@abp/core";
import { AbpAuthenticationOptions, AuthenticateResult, type AbpHttpContext, type IAuthenticationHandler } from "@abp/aws-lambda";
import { AbpJwtBearerOptions } from "@abp/auth-jwt";
import { AbpPermissionManagementDomainIdentityModule, AbpPermissionManagementDomainOpenIddictModule } from "@abp/permission-management/domain";
import { AbpPermissionManagementMemoryDbModule } from "@abp/permission-management/memory-db";
import { AbpClaimTypes, Claim } from "@abp/security";
import { AbpTestBaseModule } from "@abp/test-base";
import { AbpIdentityApplicationModule } from "../src/application/index.js";
import { AbpIdentityAuthModule } from "../src/auth/index.js";
import { AbpUserClaimsPrincipalFactory, IdentityUserManager } from "../src/domain/index.js";
import { AbpIdentityHttpApiModule } from "../src/http-api/index.js";
import { AbpIdentityMemoryDbModule } from "../src/memory-db/index.js";

export const testSigningSecret = "0123456789abcdef0123456789abcdef-identity-test-secret";

/** Authenticates the user named by the `x-test-user` header with the claims the identity module builds for that user; `x-test-client` adds a `client_id` claim. */
@Transient()
export class HeaderAuthenticationHandler implements IAuthenticationHandler {
  static readonly inject = [IdentityUserManager, AbpUserClaimsPrincipalFactory] as const;

  constructor(
    private readonly userManager: IdentityUserManager,
    private readonly principalFactory: AbpUserClaimsPrincipalFactory,
  ) {}

  async authenticate(context: AbpHttpContext): Promise<AuthenticateResult> {
    const userName = context.request.headers.get("x-test-user");
    if (!userName) return AuthenticateResult.noResult();
    const user = await this.userManager.findByName(userName);
    if (!user) return AuthenticateResult.noResult();
    const principal = await this.principalFactory.create(user);
    const clientId = context.request.headers.get("x-test-client");
    if (clientId) principal.identities[0]!.addClaim(new Claim(AbpClaimTypes.clientId, clientId));
    return AuthenticateResult.success(principal);
  }
}

/** Startup module of the identity tests: memory-db storage, HTTP API, the auth-jwt token endpoint and header authentication. */
@DependsOn(AbpIdentityApplicationModule, AbpIdentityHttpApiModule, AbpIdentityMemoryDbModule, AbpIdentityAuthModule, AbpPermissionManagementMemoryDbModule, AbpPermissionManagementDomainIdentityModule, AbpPermissionManagementDomainOpenIddictModule, AbpTestBaseModule)
export class IdentityTestModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    context.services.addType(HeaderAuthenticationHandler);
    this.configure(AbpAuthenticationOptions, (options) => options.addScheme("Test", HeaderAuthenticationHandler));
    this.configure(AbpJwtBearerOptions, (options) => {
      options.signing = { kind: "hmac", secret: testSigningSecret };
    });
  }
}
