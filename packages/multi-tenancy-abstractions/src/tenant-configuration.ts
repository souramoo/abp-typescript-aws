import { Check, Transient, createToken, type Guid } from "@abp/core";
import { ConnectionStrings } from "./connection-strings.js";

/** Port of `TenantConfiguration`. */
export class TenantConfiguration {
  id: Guid;
  name: string;
  normalizedName: string;
  connectionStrings: ConnectionStrings | undefined;
  isActive = true;
  editionId: Guid | undefined;

  constructor(id: Guid, name: string, normalizedName?: string, editionId?: Guid) {
    Check.notNull(id, "id");
    Check.notNull(name, "name");
    this.id = id;
    this.name = name;
    this.normalizedName = normalizedName ?? name.toUpperCase();
    this.editionId = editionId;
    this.connectionStrings = new ConnectionStrings();
  }
}

/** Port of `ITenantStore`. `find(idOrName)` dispatches on whether the value parses as a Guid. */
export interface ITenantStore {
  findById(id: Guid): Promise<TenantConfiguration | undefined>;
  findByName(normalizedName: string): Promise<TenantConfiguration | undefined>;
  find(idOrName: string): Promise<TenantConfiguration | undefined>;
  getList(includeDetails?: boolean): Promise<readonly TenantConfiguration[]>;
}
export const ITenantStore = createToken<ITenantStore>("ITenantStore");

/** Port of `ITenantNormalizer`. */
export interface ITenantNormalizer {
  normalizeName(name: string | undefined): string | undefined;
}
export const ITenantNormalizer = createToken<ITenantNormalizer>("ITenantNormalizer");

/** Port of `UpperInvariantTenantNormalizer`. */
@Transient(ITenantNormalizer)
export class UpperInvariantTenantNormalizer implements ITenantNormalizer {
  normalizeName(name: string | undefined): string | undefined {
    return name?.normalize().toUpperCase();
  }
}

/** Port of `AbpDefaultTenantStoreOptions` (tenants defined in code or configuration). */
export class AbpDefaultTenantStoreOptions {
  tenants: TenantConfiguration[] = [];
}

/** Port of `TenantChangedEvent`. */
export class TenantChangedEvent {
  constructor(
    public id: Guid | undefined = undefined,
    public normalizedName: string | undefined = undefined,
  ) {}
}
