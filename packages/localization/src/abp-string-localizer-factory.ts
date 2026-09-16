import { AbpException, Dependency, IServiceProviderToken, IStringLocalizerFactory, keyedToken, optionsToken, ServiceLifetime, type Class, type IOptions, type IServiceProvider, type IStringLocalizer, type ServiceToken } from "@abp/core";
import { AbpLocalizationOptions } from "./abp-localization-options.js";
import { AbpDictionaryBasedStringLocalizer, NullStringLocalizer } from "./abp-string-localizer.js";
import { IExternalLocalizationStore } from "./external/external-localization-store.js";
import { LocalizationResourceInitializationContext } from "./localization-resource-contributor.js";
import type { LocalizationResourceBase } from "./localization-resource.js";

/** Port of `IAbpStringLocalizerFactory`: the ABP-specific members beyond the core `IStringLocalizerFactory`. */
export interface IAbpStringLocalizerFactory extends IStringLocalizerFactory {
  createByResourceNameOrNull(resourceName: string): IStringLocalizer | undefined;
  createByResourceNameOrNullAsync(resourceName: string): Promise<IStringLocalizer | undefined>;
  createByResourceNameAsync(resourceName: string): Promise<IStringLocalizer>;
}
export function isAbpStringLocalizerFactory(factory: IStringLocalizerFactory): factory is IAbpStringLocalizerFactory {
  return typeof (factory as IAbpStringLocalizerFactory).createByResourceNameOrNullAsync === "function";
}

/** Port of `IStringLocalizer<TResource>`: `stringLocalizerToken(MyResource)` resolves the localizer of that resource. */
export function stringLocalizerToken(resourceType: Class): ServiceToken<IStringLocalizer> {
  return keyedToken<IStringLocalizer>(IStringLocalizerFactory, resourceType);
}

/**
 * Port of `AbpStringLocalizerFactory`. Registered with `Replace` semantics as the `IStringLocalizerFactory` singleton.
 * There is no resx fallback: an unregistered resource class yields a localizer that finds nothing.
 */
@Dependency({ lifetime: ServiceLifetime.Singleton, exposes: [IStringLocalizerFactory], replaceServices: true })
export class AbpStringLocalizerFactory implements IAbpStringLocalizerFactory {
  static readonly inject = [optionsToken(AbpLocalizationOptions), IServiceProviderToken, IExternalLocalizationStore] as const;

  readonly abpLocalizationOptions: AbpLocalizationOptions;
  protected readonly localizerCache = new Map<string, AbpDictionaryBasedStringLocalizer>();

  constructor(
    options: IOptions<AbpLocalizationOptions>,
    protected readonly serviceProvider: IServiceProvider,
    protected readonly externalLocalizationStore: IExternalLocalizationStore,
  ) {
    this.abpLocalizationOptions = options.value;
  }

  create(resourceType: Class): IStringLocalizer {
    const resource = this.abpLocalizationOptions.resources.getOrNull(resourceType);
    if (!resource) return NullStringLocalizer.instance;
    return this.createInternal(resource.resourceName, resource);
  }

  createByResourceName(resourceName: string): IStringLocalizer {
    const localizer = this.createByResourceNameOrNull(resourceName);
    if (!localizer) throw new AbpException(`Couldn't find a localizer with given resource name: ${resourceName}`);
    return localizer;
  }

  createByResourceNameOrNull(resourceName: string): IStringLocalizer | undefined {
    const resource = this.abpLocalizationOptions.resources.get(resourceName) ?? this.externalLocalizationStore.getResourceOrNull(resourceName);
    if (!resource) return undefined;
    return this.createInternal(resourceName, resource);
  }

  async createByResourceNameOrNullAsync(resourceName: string): Promise<IStringLocalizer | undefined> {
    const resource = this.abpLocalizationOptions.resources.get(resourceName) ?? (await this.externalLocalizationStore.getResourceOrNullAsync(resourceName));
    if (!resource) return undefined;
    return this.createInternalAsync(resourceName, resource);
  }

  async createByResourceNameAsync(resourceName: string): Promise<IStringLocalizer> {
    const localizer = await this.createByResourceNameOrNullAsync(resourceName);
    if (!localizer) throw new AbpException(`Couldn't find a localizer with given resource name: ${resourceName}`);
    return localizer;
  }

  createDefaultOrNull(): IStringLocalizer | undefined {
    const type = this.abpLocalizationOptions.defaultResourceType;
    return type ? this.create(type) : undefined;
  }

  private createInternal(resourceName: string, resource: LocalizationResourceBase): IStringLocalizer {
    const cached = this.localizerCache.get(resourceName);
    if (cached) return cached;
    const created = this.createStringLocalizer(resource);
    this.localizerCache.set(resourceName, created);
    return created;
  }

  private async createInternalAsync(resourceName: string, resource: LocalizationResourceBase): Promise<IStringLocalizer> {
    const cached = this.localizerCache.get(resourceName);
    if (cached) return cached;
    const created = await this.createStringLocalizerAsync(resource);
    return this.localizerCache.get(resourceName) ?? (this.localizerCache.set(resourceName, created), created);
  }

  private initializeContributors(resource: LocalizationResourceBase): void {
    for (const globalContributorType of this.abpLocalizationOptions.globalContributors) {
      resource.contributors.add(new globalContributorType());
    }
    const context = new LocalizationResourceInitializationContext(resource, this.serviceProvider);
    for (const contributor of resource.contributors) contributor.initialize(context);
  }

  private createStringLocalizer(resource: LocalizationResourceBase): AbpDictionaryBasedStringLocalizer {
    this.initializeContributors(resource);
    const baseLocalizers = resource.baseResourceNames.map((name) => this.createByResourceNameOrNull(name)).filter((l): l is IStringLocalizer => l !== undefined);
    return new AbpDictionaryBasedStringLocalizer(resource, baseLocalizers, this.abpLocalizationOptions);
  }

  private async createStringLocalizerAsync(resource: LocalizationResourceBase): Promise<AbpDictionaryBasedStringLocalizer> {
    this.initializeContributors(resource);
    const baseLocalizers: IStringLocalizer[] = [];
    for (const name of resource.baseResourceNames) {
      const base = await this.createByResourceNameOrNullAsync(name);
      if (base) baseLocalizers.push(base);
    }
    return new AbpDictionaryBasedStringLocalizer(resource, baseLocalizers, this.abpLocalizationOptions);
  }
}
