import { AbpException, Guid, IConfiguration, NullAsyncDisposable, Singleton, Transient, createToken, isNullOrWhiteSpace, type ServiceKey } from "@abp/core";
import { ConfigurationFeatureValueProvider, DefaultValueFeatureValueProvider, EditionFeatureValueProvider, TenantFeatureValueProvider, type FeatureDefinition } from "@abp/features";
import { ICurrentTenant, ITenantStore } from "@abp/multi-tenancy-abstractions";
import { ICurrentPrincipalAccessor, findEditionId } from "@abp/security";
import { IFeatureManagementStore } from "./feature-management-store.js";

/** Port of `IFeatureManagementProvider`. */
export interface IFeatureManagementProvider {
  readonly name: string;
  /** Whether values requested for `providerName` may come from this provider (the edition provider also answers tenant requests). */
  compatible(providerName: string): boolean;
  /** Prepares the ambient context for reading the fallback of `providerName`/`providerKey` (the tenant provider switches the current tenant). */
  handleContext(providerName: string, providerKey: string | undefined): Promise<AsyncDisposable>;
  getOrNull(feature: FeatureDefinition, providerKey: string | undefined): Promise<string | undefined>;
  set(feature: FeatureDefinition, value: string, providerKey: string | undefined): Promise<void>;
  clear(feature: FeatureDefinition, providerKey: string | undefined): Promise<void>;
}
export const IFeatureManagementProvider = createToken<IFeatureManagementProvider>("IFeatureManagementProvider");

/** Port of `FeatureManagementProvider`: a provider backed by the `IFeatureManagementStore`. Concrete subclasses need their own `@Transient()`. */
export abstract class FeatureManagementProvider implements IFeatureManagementProvider {
  static readonly inject: readonly ServiceKey[] = [IFeatureManagementStore];
  abstract readonly name: string;

  constructor(protected readonly store: IFeatureManagementStore) {}

  compatible(providerName: string): boolean {
    return providerName === this.name;
  }

  async handleContext(_providerName: string, _providerKey: string | undefined): Promise<AsyncDisposable> {
    return NullAsyncDisposable;
  }

  async getOrNull(feature: FeatureDefinition, providerKey: string | undefined): Promise<string | undefined> {
    return this.store.getOrNull(feature.name, this.name, await this.normalizeProviderKey(providerKey));
  }

  async set(feature: FeatureDefinition, value: string, providerKey: string | undefined): Promise<void> {
    await this.store.set(feature.name, value, this.name, await this.normalizeProviderKey(providerKey));
  }

  async clear(feature: FeatureDefinition, providerKey: string | undefined): Promise<void> {
    await this.store.delete(feature.name, this.name, await this.normalizeProviderKey(providerKey));
  }

  protected async normalizeProviderKey(providerKey: string | undefined): Promise<string | undefined> {
    return providerKey;
  }
}

/** Port of `DefaultValueFeatureManagementProvider` ("D"): read-only default values of the definitions. */
@Singleton()
export class DefaultValueFeatureManagementProvider implements IFeatureManagementProvider {
  readonly name = DefaultValueFeatureValueProvider.ProviderName;

  compatible(providerName: string): boolean {
    return providerName === this.name;
  }

  async handleContext(): Promise<AsyncDisposable> {
    return NullAsyncDisposable;
  }

  async getOrNull(feature: FeatureDefinition): Promise<string | undefined> {
    return feature.defaultValue;
  }

  async set(): Promise<void> {
    throw new AbpException("Can not set default value of a feature. It is only possible while defining the feature in a IFeatureDefinitionProvider implementation.");
  }

  async clear(): Promise<void> {
    throw new AbpException("Can not clear default value of a feature. It is only possible while defining the feature in a IFeatureDefinitionProvider implementation.");
  }
}

/** Port of `ConfigurationFeatureManagementProvider` ("C"): read-only values of `Features:<name>` in the configuration. */
@Singleton()
export class ConfigurationFeatureManagementProvider implements IFeatureManagementProvider {
  static readonly inject = [IConfiguration] as const;
  readonly name = ConfigurationFeatureValueProvider.ProviderName;

  constructor(protected readonly configuration: IConfiguration) {}

  compatible(providerName: string): boolean {
    return providerName === this.name;
  }

  async handleContext(): Promise<AsyncDisposable> {
    return NullAsyncDisposable;
  }

  async getOrNull(feature: FeatureDefinition): Promise<string | undefined> {
    return this.configuration.get(ConfigurationFeatureValueProvider.ConfigurationNamePrefix + feature.name);
  }

  async set(): Promise<void> {
    throw new AbpException("Can not set a feature value to the application configuration.");
  }

  async clear(): Promise<void> {
    throw new AbpException("Can not set a feature value to the application configuration.");
  }
}

/**
 * Port of `EditionFeatureManagementProvider` ("E"). A tenant request resolves to the tenant's edition; otherwise the
 * key is an edition id, the current tenant's edition or the edition claim of the principal.
 */
@Transient()
export class EditionFeatureManagementProvider extends FeatureManagementProvider {
  static override readonly inject = [IFeatureManagementStore, ICurrentPrincipalAccessor, ITenantStore, ICurrentTenant] as const;
  readonly name = EditionFeatureValueProvider.ProviderName;
  protected currentCompatibleProviderName: string | undefined = undefined;

  constructor(
    store: IFeatureManagementStore,
    protected readonly principalAccessor: ICurrentPrincipalAccessor,
    protected readonly tenantStore: ITenantStore,
    protected readonly currentTenant: ICurrentTenant,
  ) {
    super(store);
  }

  override compatible(providerName: string): boolean {
    this.currentCompatibleProviderName = providerName;
    return providerName === TenantFeatureValueProvider.ProviderName || super.compatible(providerName);
  }

  protected override async normalizeProviderKey(providerKey: string | undefined): Promise<string | undefined> {
    return this.findEditionId(providerKey);
  }

  protected async findEditionId(providerKey: string | undefined): Promise<Guid | undefined> {
    if (providerKey !== undefined && Guid.isValid(providerKey)) {
      const parsedEditionOrTenantId = Guid.parse(providerKey);
      if (this.currentCompatibleProviderName === TenantFeatureValueProvider.ProviderName) {
        const tenant = await this.tenantStore.findById(parsedEditionOrTenantId);
        if (tenant) return tenant.editionId;
      }
      return parsedEditionOrTenantId;
    }

    if (this.currentTenant.id !== undefined) {
      const tenant = await this.tenantStore.findById(this.currentTenant.id);
      if (tenant) return tenant.editionId;
    }

    return findEditionId(this.principalAccessor.principal);
  }
}

/** Port of `TenantFeatureManagementProvider` ("T"): the provider key defaults to the current tenant. */
@Transient()
export class TenantFeatureManagementProvider extends FeatureManagementProvider {
  static override readonly inject = [IFeatureManagementStore, ICurrentTenant] as const;
  readonly name = TenantFeatureValueProvider.ProviderName;

  constructor(
    store: IFeatureManagementStore,
    protected readonly currentTenant: ICurrentTenant,
  ) {
    super(store);
  }

  /** Switches the current tenant while the fallback of a tenant key is computed (the edition provider reads it). */
  override async handleContext(providerName: string, providerKey: string | undefined): Promise<AsyncDisposable> {
    if (providerName === this.name && !isNullOrWhiteSpace(providerKey) && Guid.isValid(providerKey)) {
      const disposable = this.currentTenant.change(Guid.parse(providerKey));
      return {
        [Symbol.asyncDispose]: async () => {
          disposable[Symbol.dispose]();
        },
      };
    }
    return super.handleContext(providerName, providerKey);
  }

  protected override async normalizeProviderKey(providerKey: string | undefined): Promise<string | undefined> {
    return providerKey ?? this.currentTenant.id;
  }
}
