import { AbpException, Scoped, createToken, optionsToken, type IConfiguration, type IOptions } from "@abp/core";
import { ICurrentTenant, IMultiTenantUrlProvider } from "@abp/multi-tenancy-abstractions";

/** Port of `RemoteServiceConfiguration`: a string dictionary with well-known `BaseUrl` and `Version` entries. */
export class RemoteServiceConfiguration extends Map<string, string | undefined> {
  constructor(baseUrl?: string | RemoteServiceConfiguration, version?: string) {
    super(baseUrl instanceof Map ? baseUrl : undefined);
    if (typeof baseUrl === "string") {
      this.baseUrl = baseUrl;
      this.version = version;
    }
  }

  get baseUrl(): string {
    return this.get("BaseUrl") ?? "";
  }
  set baseUrl(value: string) {
    this.set("BaseUrl", value);
  }

  get version(): string | undefined {
    return this.get("Version");
  }
  set version(value: string | undefined) {
    this.set("Version", value);
  }
}

/** Port of `RemoteServiceConfigurationDictionary`. */
export class RemoteServiceConfigurationDictionary extends Map<string, RemoteServiceConfiguration | undefined> {
  static readonly DefaultName = "Default";

  get default(): RemoteServiceConfiguration | undefined {
    return this.get(RemoteServiceConfigurationDictionary.DefaultName);
  }
  set default(value: RemoteServiceConfiguration | undefined) {
    this.set(RemoteServiceConfigurationDictionary.DefaultName, value);
  }

  getConfigurationOrDefault(name: string): RemoteServiceConfiguration {
    const configuration = this.getConfigurationOrDefaultOrNull(name);
    if (!configuration) throw new AbpException(`Remote service '${name}' was not found and there is no default configuration.`);
    return configuration;
  }

  getConfigurationOrDefaultOrNull(name: string): RemoteServiceConfiguration | undefined {
    return this.get(name) ?? this.default;
  }
}

/** Port of `AbpRemoteServiceOptions`. */
export class AbpRemoteServiceOptions {
  remoteServices = new RemoteServiceConfigurationDictionary();
}

/** Port of `IRemoteServiceConfigurationProvider` (+ the parameterless extension overloads via a default `name`). */
export interface IRemoteServiceConfigurationProvider {
  getConfigurationOrDefault(name?: string): Promise<RemoteServiceConfiguration>;
  getConfigurationOrDefaultOrNull(name?: string): Promise<RemoteServiceConfiguration | undefined>;
}
export const IRemoteServiceConfigurationProvider = createToken<IRemoteServiceConfigurationProvider>("IRemoteServiceConfigurationProvider");

/** Port of `RemoteServiceConfigurationProvider`: applies the multi-tenant URL placeholders to `BaseUrl`. */
@Scoped(IRemoteServiceConfigurationProvider)
export class RemoteServiceConfigurationProvider implements IRemoteServiceConfigurationProvider {
  static readonly inject = [optionsToken(AbpRemoteServiceOptions), IMultiTenantUrlProvider, ICurrentTenant] as const;
  protected readonly options: AbpRemoteServiceOptions;

  constructor(
    options: IOptions<AbpRemoteServiceOptions>,
    protected readonly multiTenantUrlProvider: IMultiTenantUrlProvider,
    protected readonly currentTenant: ICurrentTenant,
  ) {
    this.options = options.value;
  }

  async getConfigurationOrDefault(name = RemoteServiceConfigurationDictionary.DefaultName): Promise<RemoteServiceConfiguration> {
    return (await this.getMultiTenantConfiguration(this.options.remoteServices.getConfigurationOrDefault(name)))!;
  }

  async getConfigurationOrDefaultOrNull(name = RemoteServiceConfigurationDictionary.DefaultName): Promise<RemoteServiceConfiguration | undefined> {
    return this.getMultiTenantConfiguration(this.options.remoteServices.getConfigurationOrDefaultOrNull(name));
  }

  protected async getMultiTenantConfiguration(configuration: RemoteServiceConfiguration | undefined): Promise<RemoteServiceConfiguration | undefined> {
    if (!configuration) return configuration;
    const baseUrl = await this.multiTenantUrlProvider.getUrl(configuration.baseUrl);
    if (baseUrl === configuration.baseUrl) return configuration;
    const multiTenantConfiguration = new RemoteServiceConfiguration(configuration);
    multiTenantConfiguration.baseUrl = baseUrl;
    return multiTenantConfiguration;
  }
}

/** Port of `Configure<AbpRemoteServiceOptions>(configuration)`: binds the `RemoteServices` section (`RemoteServices:Default:BaseUrl`). */
export function bindRemoteServicesFromConfiguration(configuration: IConfiguration, options: AbpRemoteServiceOptions, sectionKey = "RemoteServices"): void {
  const section = configuration.getSection(sectionKey);
  if (!section.exists()) return;
  for (const child of section.getChildren()) {
    const remoteService = options.remoteServices.get(child.key) ?? new RemoteServiceConfiguration();
    for (const entry of child.getChildren()) {
      if (entry.value !== undefined) remoteService.set(entry.key, entry.value);
    }
    options.remoteServices.set(child.key, remoteService);
  }
}
