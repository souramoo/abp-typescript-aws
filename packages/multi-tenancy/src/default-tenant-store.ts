import { Dependency, Guid, Transient, optionsToken, type IConfiguration, type IOptions } from "@abp/core";
import { AbpDefaultTenantStoreOptions, ConnectionStrings, ITenantStore, TenantConfiguration } from "@abp/multi-tenancy-abstractions";

/** Port of `DefaultTenantStore`: tenants come from `AbpDefaultTenantStoreOptions` (code or the `Tenants` configuration section). */
@Dependency({ tryRegister: true })
@Transient(ITenantStore)
export class DefaultTenantStore implements ITenantStore {
  static readonly inject = [optionsToken(AbpDefaultTenantStoreOptions)] as const;
  private readonly options: AbpDefaultTenantStoreOptions;

  constructor(options: IOptions<AbpDefaultTenantStoreOptions>) {
    this.options = options.value;
  }

  async findById(id: Guid): Promise<TenantConfiguration | undefined> {
    return this.options.tenants.find((t) => Guid.equals(t.id, id));
  }

  async findByName(normalizedName: string): Promise<TenantConfiguration | undefined> {
    return this.options.tenants.find((t) => t.normalizedName === normalizedName);
  }

  find(idOrName: string): Promise<TenantConfiguration | undefined> {
    return Guid.isValid(idOrName) ? this.findById(idOrName) : this.findByName(idOrName);
  }

  async getList(): Promise<readonly TenantConfiguration[]> {
    return this.options.tenants;
  }
}

function lowerKeys(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k.toLowerCase(), v]));
}

/**
 * Port of `Configure<AbpDefaultTenantStoreOptions>(configuration)`: binds the `Tenants` array
 * (`Id`, `Name`, `NormalizedName`, `IsActive`, `EditionId`, `ConnectionStrings`) from configuration.
 * `NormalizedName` defaults to the upper-cased name when omitted.
 */
export function bindTenantsFromConfiguration(configuration: IConfiguration, sectionKey = "Tenants"): TenantConfiguration[] {
  const section = configuration.getSection(sectionKey);
  if (!section.exists()) return [];
  const raw = section.toObject<unknown>();
  const entries = Array.isArray(raw) ? raw : Object.values(raw as Record<string, unknown>);
  const tenants: TenantConfiguration[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const t = lowerKeys(entry as Record<string, unknown>);
    if (typeof t["id"] !== "string" || typeof t["name"] !== "string") continue;
    const tenant = new TenantConfiguration(Guid.parse(t["id"]), t["name"], typeof t["normalizedname"] === "string" ? t["normalizedname"] : undefined, typeof t["editionid"] === "string" ? t["editionid"] : undefined);
    if (typeof t["isactive"] === "boolean") tenant.isActive = t["isactive"];
    const connectionStrings = t["connectionstrings"];
    if (typeof connectionStrings === "object" && connectionStrings !== null) {
      tenant.connectionStrings = new ConnectionStrings(Object.entries(connectionStrings as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"));
    }
    tenants.push(tenant);
  }
  return tenants;
}
