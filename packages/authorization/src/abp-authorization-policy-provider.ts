import { Transient, createToken, distinct, optionsToken, type IOptions } from "@abp/core";
import { AbpAuthorizationOptions, AuthorizationPolicy, PermissionRequirement, ResourcePermissionRequirement } from "./authorization-requirements.js";
import { IPermissionDefinitionManager } from "./permissions/permission-definition-store.js";

/** Port of `IAbpAuthorizationPolicyProvider` (`IAuthorizationPolicyProvider` + `GetPoliciesNamesAsync`). */
export interface IAbpAuthorizationPolicyProvider {
  getPolicy(policyName: string): Promise<AuthorizationPolicy | undefined>;
  getDefaultPolicy(): Promise<AuthorizationPolicy>;
  getFallbackPolicy(): Promise<AuthorizationPolicy | undefined>;
  getPoliciesNames(): Promise<string[]>;
}
export const IAbpAuthorizationPolicyProvider = createToken<IAbpAuthorizationPolicyProvider>("IAbpAuthorizationPolicyProvider");

/**
 * Port of `AbpAuthorizationPolicyProvider` (+ the `DefaultAuthorizationPolicyProvider` it extends): a registered
 * policy wins, otherwise a permission or resource permission with that name becomes a permission-based policy.
 */
@Transient(IAbpAuthorizationPolicyProvider)
export class AbpAuthorizationPolicyProvider implements IAbpAuthorizationPolicyProvider {
  static readonly inject = [optionsToken(AbpAuthorizationOptions), IPermissionDefinitionManager] as const;
  private readonly options: AbpAuthorizationOptions;

  constructor(
    options: IOptions<AbpAuthorizationOptions>,
    private readonly permissionDefinitionManager: IPermissionDefinitionManager,
  ) {
    this.options = options.value;
  }

  async getPolicy(policyName: string): Promise<AuthorizationPolicy | undefined> {
    const policy = this.options.getPolicy(policyName);
    if (policy) return policy;

    if (await this.permissionDefinitionManager.getOrNull(policyName)) return new AuthorizationPolicy([new PermissionRequirement(policyName)]);

    if ((await this.permissionDefinitionManager.getResourcePermissions()).some((x) => x.name === policyName)) {
      return new AuthorizationPolicy([new ResourcePermissionRequirement(policyName)]);
    }
    return undefined;
  }

  async getDefaultPolicy(): Promise<AuthorizationPolicy> {
    return this.options.defaultPolicy;
  }

  async getFallbackPolicy(): Promise<AuthorizationPolicy | undefined> {
    return this.options.fallbackPolicy;
  }

  async getPoliciesNames(): Promise<string[]> {
    const permissionNames = (await this.permissionDefinitionManager.getPermissions()).map((p) => p.name);
    return distinct([...this.options.getPoliciesNames(), ...permissionNames]);
  }
}
