import type { Guid} from "@abp/core";
import { AbpException, isNullOrWhiteSpace } from "@abp/core";
import { ConnectionStrings, IgnoreMultiTenancy, TenantConfiguration } from "@abp/multi-tenancy-abstractions";

interface TenantConfigurationJson {
  id: Guid;
  name: string;
  normalizedName?: string;
  connectionStrings?: Record<string, string | undefined> | null;
  isActive?: boolean;
  editionId?: Guid;
}

function reviveTenantConfiguration(raw: unknown): TenantConfiguration | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (raw instanceof TenantConfiguration) return raw;
  const json = raw as TenantConfigurationJson;
  const configuration = new TenantConfiguration(json.id, json.name, json.normalizedName, json.editionId ?? undefined);
  if (typeof json.isActive === "boolean") configuration.isActive = json.isActive;
  configuration.connectionStrings = new ConnectionStrings(json.connectionStrings ?? undefined);
  return configuration;
}

/**
 * Port of `Volo.Abp.MultiTenancy.TenantConfigurationCacheItem` (a framework class in .NET that `@abp/multi-tenancy`
 * does not ship). The distributed cache stores JSON, so the `static schema` parser revives the `TenantConfiguration`
 * (and its `ConnectionStrings` map) on read.
 */
@IgnoreMultiTenancy()
export class TenantConfigurationCacheItem {
  private static readonly CacheKeyFormat = "i:{0},n:{1}";

  static readonly schema = {
    parse(input: unknown): TenantConfigurationCacheItem {
      const value = typeof input === "object" && input !== null ? (input as { value?: unknown }).value : undefined;
      return new TenantConfigurationCacheItem(reviveTenantConfiguration(value));
    },
  };

  value: TenantConfiguration | undefined;

  constructor(value?: TenantConfiguration) {
    this.value = value;
  }

  static calculateCacheKey(id: Guid | null | undefined, name: string | null | undefined): string {
    if ((id === null || id === undefined) && isNullOrWhiteSpace(name)) throw new AbpException("Both id and name can't be invalid.");
    return TenantConfigurationCacheItem.CacheKeyFormat.replace("{0}", id ?? "null").replace("{1}", isNullOrWhiteSpace(name) ? "null" : name);
  }
}
