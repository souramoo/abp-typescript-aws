import type { Guid } from "@abp/core";
import { EventName } from "@abp/event-bus";
import type { IMultiTenant } from "@abp/multi-tenancy-abstractions";
import { IdentityClaimValueType } from "./consts.js";

/*
 * The .NET ETOs carry no `[EventName]`, so their event name is the type's full name; the same names are declared
 * here explicitly so events stay interoperable with .NET consumers.
 */

/** Port of `IdentityRoleEto`. */
@EventName("Volo.Abp.Identity.IdentityRoleEto")
export class IdentityRoleEto implements IMultiTenant {
  id!: Guid;
  tenantId: Guid | undefined = undefined;
  name!: string;
  isDefault = false;
  isStatic = false;
  isPublic = false;
  entityVersion = 0;
}

/** Port of `IdentityRoleNameChangedEto`. */
@EventName("Volo.Abp.Identity.IdentityRoleNameChangedEto")
export class IdentityRoleNameChangedEto implements IMultiTenant {
  id!: Guid;
  tenantId: Guid | undefined = undefined;
  name!: string;
  oldName!: string;
}

/** Port of `IdentityUserEmailChangedEto`. */
@EventName("Volo.Abp.Identity.IdentityUserEmailChangedEto")
export class IdentityUserEmailChangedEto implements IMultiTenant {
  id!: Guid;
  tenantId: Guid | undefined = undefined;
  email!: string;
  oldEmail!: string;
}

/** Port of `IdentityUserUserNameChangedEto`. */
@EventName("Volo.Abp.Identity.IdentityUserUserNameChangedEto")
export class IdentityUserUserNameChangedEto implements IMultiTenant {
  id!: Guid;
  tenantId: Guid | undefined = undefined;
  userName!: string;
  oldUserName!: string;
}

/** Port of `IdentityUserPasswordChangedEto`. */
@EventName("Volo.Abp.Identity.IdentityUserPasswordChangedEto")
export class IdentityUserPasswordChangedEto implements IMultiTenant {
  id!: Guid;
  tenantId: Guid | undefined = undefined;
  email: string | undefined = undefined;
}

/** Port of `OrganizationUnitEto`. */
@EventName("Volo.Abp.Identity.OrganizationUnitEto")
export class OrganizationUnitEto implements IMultiTenant {
  id!: Guid;
  tenantId: Guid | undefined = undefined;
  parentId: Guid | undefined = undefined;
  code!: string;
  displayName!: string;
  entityVersion = 0;
}

/** Port of `IdentityClaimTypeEto`. */
@EventName("Volo.Abp.Identity.IdentityClaimTypeEto")
export class IdentityClaimTypeEto {
  id!: Guid;
  name!: string;
  required = false;
  isStatic = false;
  regex: string | undefined = undefined;
  regexDescription: string | undefined = undefined;
  description: string | undefined = undefined;
  valueType: IdentityClaimValueType = IdentityClaimValueType.String;
}
