import { createToken, type IServiceProvider, type IServiceProviderAccessor } from "@abp/core";
import type { TenantConfiguration } from "./tenant-configuration.js";

/** Port of `ITenantResolveContext`. */
export interface ITenantResolveContext extends IServiceProviderAccessor {
  tenantIdOrName: string | undefined;
  handled: boolean;
  readonly items: Map<string, unknown>;
  hasResolvedTenantOrHost(): boolean;
}

/** Port of `TenantResolveContext`. */
export class TenantResolveContext implements ITenantResolveContext {
  tenantIdOrName: string | undefined;
  handled = false;
  readonly items = new Map<string, unknown>();

  constructor(readonly serviceProvider: IServiceProvider) {}

  hasResolvedTenantOrHost(): boolean {
    return this.handled || this.tenantIdOrName !== undefined;
  }
}

/** Port of `ITenantResolveContributor`. Instances (not types) are added to `AbpTenantResolveOptions.tenantResolvers`. */
export interface ITenantResolveContributor {
  readonly name: string;
  resolve(context: ITenantResolveContext): Promise<void>;
}

/** Port of `TenantResolveContributorBase`. */
export abstract class TenantResolveContributorBase implements ITenantResolveContributor {
  abstract readonly name: string;
  abstract resolve(context: ITenantResolveContext): Promise<void>;
}

/** Port of `AbpTenantResolveOptions`. */
export class AbpTenantResolveOptions {
  readonly tenantResolvers: ITenantResolveContributor[] = [];
  /** Fallback tenant to use when no other resolver resolves a tenant. */
  fallbackTenant: string | undefined;
}

/** Port of `TenantResolveResult`. */
export class TenantResolveResult {
  tenantIdOrName: string | undefined;
  readonly appliedResolvers: string[] = [];
}

/** Port of `ITenantResolver`. */
export interface ITenantResolver {
  /** Tries to resolve the current tenant using the registered contributors; returns id, unique name or undefined. */
  resolveTenantIdOrName(): Promise<TenantResolveResult>;
}
export const ITenantResolver = createToken<ITenantResolver>("ITenantResolver");

/** Port of `ITenantResolveResultAccessor`. */
export interface ITenantResolveResultAccessor {
  result: TenantResolveResult | undefined;
}
export const ITenantResolveResultAccessor = createToken<ITenantResolveResultAccessor>("ITenantResolveResultAccessor");

/** Port of `ITenantConfigurationProvider`. */
export interface ITenantConfigurationProvider {
  get(saveResolveResult?: boolean): Promise<TenantConfiguration | undefined>;
}
export const ITenantConfigurationProvider = createToken<ITenantConfigurationProvider>("ITenantConfigurationProvider");

/** Port of `IMultiTenantUrlProvider`. */
export interface IMultiTenantUrlProvider {
  getUrl(templateUrl: string): Promise<string>;
}
export const IMultiTenantUrlProvider = createToken<IMultiTenantUrlProvider>("IMultiTenantUrlProvider");
