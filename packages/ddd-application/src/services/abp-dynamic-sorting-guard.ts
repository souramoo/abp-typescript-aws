import type { Class } from "@abp/core";
import { AbpValidationException } from "@abp/validation";
import { parseSorting, type SortClause } from "@abp/ddd-domain";

const propertyPath = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

/**
 * Port of `AbpDynamicSortingGuard`. .NET hooks Dynamic LINQ so user-supplied sorting strings can only access plain
 * properties; here every sort key must be a property path (no calls, operators or literals) and, when the app service
 * knows its DTO fields, its first segment must be one of them (case-insensitive).
 */
export const AbpDynamicSortingGuard = {
  message: "Sorting expression is not supported.",

  /** Validates and parses `sorting`; throws `AbpValidationException` for anything but property access. */
  check(sorting: string | null | undefined, allowedFields?: readonly string[]): SortClause[] {
    let clauses: SortClause[];
    try {
      clauses = parseSorting(sorting);
    } catch (e) {
      throw new AbpValidationException(AbpDynamicSortingGuard.message, { cause: e });
    }
    const allowed = allowedFields?.map((f) => f.toLowerCase());
    for (const clause of clauses) {
      if (!propertyPath.test(clause.field)) throw new AbpValidationException(AbpDynamicSortingGuard.message);
      const first = clause.field.split(".")[0]!.toLowerCase();
      if (allowed && !allowed.includes(first)) throw new AbpValidationException(AbpDynamicSortingGuard.message);
    }
    return clauses;
  },

  /** The sortable field names of a DTO class: the own properties of a default instance (undefined when not constructible). */
  fieldsOf(dtoType: Class | undefined): string[] | undefined {
    if (!dtoType) return undefined;
    try {
      return Object.keys(new dtoType()).filter((k) => k !== "extraProperties");
    } catch {
      return undefined;
    }
  },
};
