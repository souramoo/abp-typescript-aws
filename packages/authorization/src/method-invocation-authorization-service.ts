import { AbpException, Transient } from "@abp/core";
import { IAbpAuthorizationPolicyProvider } from "./abp-authorization-policy-provider.js";
import { IAbpAuthorizationService, IMethodInvocationAuthorizationService, type MethodInvocationAuthorizationContext } from "./abp-authorization-service.js";
import { AuthorizationPolicy, RolesAuthorizationRequirement } from "./authorization-requirements.js";
import { AuthorizeMetadata, type AuthorizeData } from "./authorize-attributes.js";

/** Port of `MethodInvocationAuthorizationService`. */
@Transient(IMethodInvocationAuthorizationService)
export class MethodInvocationAuthorizationService implements IMethodInvocationAuthorizationService {
  static readonly inject = [IAbpAuthorizationPolicyProvider, IAbpAuthorizationService] as const;

  constructor(
    private readonly policyProvider: IAbpAuthorizationPolicyProvider,
    private readonly authorizationService: IAbpAuthorizationService,
  ) {}

  async check(context: MethodInvocationAuthorizationContext): Promise<void> {
    if (this.allowAnonymous(context)) return;
    const policy = await this.combinePolicies(this.getAuthorizationData(context));
    if (!policy) return;
    await this.authorizationService.check(policy);
  }

  protected allowAnonymous(context: MethodInvocationAuthorizationContext): boolean {
    return AuthorizeMetadata.allowsAnonymous(context.targetType, context.method);
  }

  /** Method-level data first, then class-level data (every TypeScript method is public). */
  protected getAuthorizationData(context: MethodInvocationAuthorizationContext): readonly AuthorizeData[] {
    return [...AuthorizeMetadata.getForMethod(context.targetType, context.method), ...AuthorizeMetadata.getForClass(context.targetType)];
  }

  /** Port of `AuthorizationPolicy.CombineAsync(policyProvider, authorizeData)`. */
  protected async combinePolicies(authorizeData: readonly AuthorizeData[]): Promise<AuthorizationPolicy | undefined> {
    if (authorizeData.length === 0) return this.policyProvider.getFallbackPolicy();
    const policies: AuthorizationPolicy[] = [];
    for (const data of authorizeData) {
      let useDefaultPolicy = true;
      if (data.policy) {
        const policy = await this.policyProvider.getPolicy(data.policy);
        if (!policy) throw new AbpException(`The AuthorizationPolicy named: '${data.policy}' was not found.`);
        policies.push(policy);
        useDefaultPolicy = false;
      }
      if (data.roles && data.roles.length > 0) {
        policies.push(new AuthorizationPolicy([new RolesAuthorizationRequirement(data.roles)]));
        useDefaultPolicy = false;
      }
      if (useDefaultPolicy) policies.push(await this.policyProvider.getDefaultPolicy());
    }
    return AuthorizationPolicy.combine(...policies);
  }
}
