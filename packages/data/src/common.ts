import { AbpException } from "@abp/core";

/** Port of `AbpCommonDbProperties`: table prefix / schema shared by most ABP modules (mutable statics). */
export class AbpCommonDbProperties {
  static dbTablePrefix = "Abp";
  static dbSchema: string | undefined = undefined;
}

/** Port of `AbpDbConcurrencyException`. */
export class AbpDbConcurrencyException extends AbpException {}

/** Port of `IHasConcurrencyStamp`. */
export interface IHasConcurrencyStamp {
  concurrencyStamp: string;
}

/** Port of `ConcurrencyStampExtensions.SetConcurrencyStampIfNotNull`. */
export function setConcurrencyStampIfNotNull(entity: IHasConcurrencyStamp, concurrencyStamp: string | null | undefined): void {
  if (concurrencyStamp) entity.concurrencyStamp = concurrencyStamp;
}

/** Port of `AbpDataMigrationEnvironment`: registered as an object accessor to mark a migration process. */
export class AbpDataMigrationEnvironment {}
