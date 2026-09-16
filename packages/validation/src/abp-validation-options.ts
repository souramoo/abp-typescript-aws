import { TypeList, type Class } from "@abp/core";
import type { IObjectValidationContributor } from "./object-validation-contributor.js";

/** Port of `AbpValidationOptions`. */
export class AbpValidationOptions {
  /** Objects that are instances of these classes are not validated recursively. */
  readonly ignoredTypes: Class[] = [];
  readonly objectValidationContributors = new TypeList<IObjectValidationContributor>();
}
