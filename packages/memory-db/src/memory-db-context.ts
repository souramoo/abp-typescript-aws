import type { AbstractClass } from "@abp/core";

/** Port of `AbpMemoryDbConsts`. */
export const AbpMemoryDbConsts = {
  ProviderName: "Volo.Abp.MemoryDb",
} as const;

/**
 * Port of `MemoryDbContext` (a singleton). Declare the entity classes the context owns in `entities`; use
 * `@ConnectionStringName("...")` from `@abp/data` to pick the database, otherwise the default connection is used.
 */
export abstract class MemoryDbContext {
  readonly entities: readonly AbstractClass[] = [];

  getEntityTypes(): readonly AbstractClass[] {
    return this.entities;
  }
}
