import { Check, type Guid } from "@abp/core";
import { AggregateRoot } from "@abp/ddd-domain";
import { IdentityClaimValueType } from "../domain-shared/index.js";

export interface IdentityClaimTypeInit {
  required?: boolean;
  isStatic?: boolean;
  regex?: string;
  regexDescription?: string;
  description?: string;
  valueType?: IdentityClaimValueType;
}

/** Port of `IdentityClaimType` (the positional .NET constructor arguments after `name` become `init`). */
export class IdentityClaimType extends AggregateRoot<Guid> {
  name!: string;
  required = false;
  isStatic = false;
  regex: string | undefined = undefined;
  regexDescription: string | undefined = undefined;
  description: string | undefined = undefined;
  valueType: IdentityClaimValueType = IdentityClaimValueType.String;
  creationTime!: Date;

  constructor(id?: Guid, name?: string, init: IdentityClaimTypeInit = {}) {
    super(id);
    if (id === undefined) return;
    this.setName(Check.notNull(name, "name"));
    this.required = init.required ?? false;
    this.isStatic = init.isStatic ?? false;
    this.regex = init.regex;
    this.regexDescription = init.regexDescription;
    this.description = init.description;
    this.valueType = init.valueType ?? IdentityClaimValueType.String;
  }

  setName(name: string): void {
    this.name = Check.notNull(name, "name");
  }
}
