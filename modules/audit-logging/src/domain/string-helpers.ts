import { truncate } from "@abp/core";

/** Port of `AbpStringExtensions.TruncateFromBeginning`: keeps the last `maxLength` characters. */
export function truncateFromBeginning(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  return value.length <= maxLength ? value : value.slice(value.length - maxLength);
}

/** `Truncate` on a possibly missing value (`null` returns `null` in .NET). */
export function truncateOrUndefined(value: string | undefined, maxLength: number): string | undefined {
  return value === undefined ? undefined : truncate(value, maxLength);
}
