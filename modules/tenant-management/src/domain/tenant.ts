import { Check, type Guid } from "@abp/core";
import type { IHasEntityVersion } from "@abp/auditing";
import { FullAuditedAggregateRoot } from "@abp/ddd-domain";
import { ConnectionStrings } from "@abp/multi-tenancy-abstractions";
import { TenantConsts } from "../domain-shared/index.js";
import { TenantConnectionString } from "./tenant-connection-string.js";

/**
 * Port of `Tenant`. The .NET `protected internal` setters become plain methods; `TenantManager` is the sanctioned
 * caller of `setName`/`setNormalizedName` (it validates uniqueness).
 */
export class Tenant extends FullAuditedAggregateRoot<Guid> implements IHasEntityVersion {
  name!: string;
  normalizedName: string | undefined = undefined;
  entityVersion = 0;
  connectionStrings: TenantConnectionString[] = [];

  constructor(id: Guid, name: string, normalizedName?: string) {
    super(id);
    if (id === undefined) return;
    this.setName(name);
    this.setNormalizedName(normalizedName);
  }

  findDefaultConnectionString(): string | undefined {
    return this.findConnectionString(ConnectionStrings.DefaultConnectionStringName);
  }

  findConnectionString(name: string): string | undefined {
    return this.connectionStrings.find((c) => c.name === name)?.value;
  }

  setDefaultConnectionString(connectionString: string): void {
    this.setConnectionString(ConnectionStrings.DefaultConnectionStringName, connectionString);
  }

  setConnectionString(name: string, connectionString: string): void {
    const tenantConnectionString = this.connectionStrings.find((x) => x.name === name);
    if (tenantConnectionString) tenantConnectionString.setValue(connectionString);
    else this.connectionStrings.push(new TenantConnectionString(this.id, name, connectionString));
  }

  removeDefaultConnectionString(): void {
    this.removeConnectionString(ConnectionStrings.DefaultConnectionStringName);
  }

  removeConnectionString(name: string): void {
    const index = this.connectionStrings.findIndex((x) => x.name === name);
    if (index >= 0) this.connectionStrings.splice(index, 1);
  }

  setName(name: string): void {
    this.name = Check.notNullOrWhiteSpace(name, "name", TenantConsts.maxNameLength);
  }

  setNormalizedName(normalizedName: string | undefined): void {
    this.normalizedName = normalizedName;
  }
}
