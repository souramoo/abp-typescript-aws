import type { Guid } from "@abp/core";
import { ExtensibleEntityDto, ExtensibleFullAuditedEntityDto, ExtensiblePagedAndSortedResultRequestDto } from "@abp/ddd-application";
import { ExtensibleObject } from "@abp/object-extending";
import { z } from "zod";
import { IdentityRoleConsts, IdentityUserConsts } from "../domain-shared/index.js";

/** Paging defaults apply when the query string omits them, like the .NET DTO property initializers. */
const pagedAndSortedShape = {
  sorting: z.string().nullish(),
  skipCount: z.number().int().min(0).default(0),
  maxResultCount: z.number().int().min(1).default(ExtensiblePagedAndSortedResultRequestDto.defaultMaxResultCount),
};
const optionalString = (maxLength: number) => z.string().max(maxLength).nullish();

/** Port of `IdentityUserDto` (`ExtensibleFullAuditedEntityDto<Guid>`, `IMultiTenant`, `IHasConcurrencyStamp`, `IHasEntityVersion`). */
export class IdentityUserDto extends ExtensibleFullAuditedEntityDto<Guid> {
  tenantId: Guid | undefined = undefined;
  userName!: string;
  name: string | undefined = undefined;
  surname: string | undefined = undefined;
  email!: string;
  emailConfirmed = false;
  phoneNumber: string | undefined = undefined;
  phoneNumberConfirmed = false;
  isActive = true;
  lockoutEnabled = false;
  accessFailedCount = 0;
  lockoutEnd: Date | undefined = undefined;
  concurrencyStamp!: string;
  entityVersion = 0;
  lastPasswordChangeTime: Date | undefined = undefined;
}

const userCreateOrUpdateShape = {
  userName: z.string().min(1).max(IdentityUserConsts.maxUserNameLength),
  name: optionalString(IdentityUserConsts.maxNameLength),
  surname: optionalString(IdentityUserConsts.maxSurnameLength),
  email: z.string().min(1).email().max(IdentityUserConsts.maxEmailLength),
  phoneNumber: optionalString(IdentityUserConsts.maxPhoneNumberLength),
  isActive: z.boolean().default(false),
  lockoutEnabled: z.boolean().default(false),
  roleNames: z.array(z.string()).nullish(),
};

/** Port of `IdentityUserCreateOrUpdateDtoBase`. */
export abstract class IdentityUserCreateOrUpdateDtoBase extends ExtensibleObject {
  userName!: string;
  name: string | undefined = undefined;
  surname: string | undefined = undefined;
  email!: string;
  phoneNumber: string | undefined = undefined;
  isActive = false;
  lockoutEnabled = false;
  roleNames: string[] | undefined = undefined;

  protected constructor() {
    super(false);
  }
}

/** Port of `IdentityUserCreateDto`. */
export class IdentityUserCreateDto extends IdentityUserCreateOrUpdateDtoBase {
  static readonly schema = z.object({ ...userCreateOrUpdateShape, password: z.string().min(1).max(IdentityUserConsts.maxPasswordLength) });
  password!: string;

  constructor() {
    super();
  }
}

/** Port of `IdentityUserUpdateDto`. */
export class IdentityUserUpdateDto extends IdentityUserCreateOrUpdateDtoBase {
  static readonly schema = z.object({ ...userCreateOrUpdateShape, password: z.string().max(IdentityUserConsts.maxPasswordLength).nullish(), concurrencyStamp: z.string().nullish() });
  password: string | undefined = undefined;
  concurrencyStamp: string | undefined = undefined;

  constructor() {
    super();
  }
}

/** Port of `IdentityUserUpdateRolesDto`. */
export class IdentityUserUpdateRolesDto {
  static readonly schema = z.object({ roleNames: z.array(z.string()) });
  roleNames: string[] = [];
}

/** Port of `GetIdentityUsersInput`. */
export class GetIdentityUsersInput extends ExtensiblePagedAndSortedResultRequestDto {
  static override readonly schema = z.object({ ...pagedAndSortedShape, filter: z.string().nullish() });
  filter: string | undefined = undefined;
}

/** Port of `IdentityRoleDto` (`ExtensibleEntityDto<Guid>`, `IHasConcurrencyStamp`, `IHasCreationTime`). */
export class IdentityRoleDto extends ExtensibleEntityDto<Guid> {
  name!: string;
  isDefault = false;
  isStatic = false;
  isPublic = false;
  concurrencyStamp!: string;
  creationTime!: Date;
}

const roleCreateOrUpdateShape = {
  name: z.string().min(1).max(IdentityRoleConsts.maxNameLength),
  isDefault: z.boolean().default(false),
  isPublic: z.boolean().default(false),
};

/** Port of `IdentityRoleCreateOrUpdateDtoBase`. */
export class IdentityRoleCreateOrUpdateDtoBase extends ExtensibleObject {
  name!: string;
  isDefault = false;
  isPublic = false;

  constructor() {
    super(false);
  }
}

/** Port of `IdentityRoleCreateDto`. */
export class IdentityRoleCreateDto extends IdentityRoleCreateOrUpdateDtoBase {
  static readonly schema = z.object(roleCreateOrUpdateShape);
}

/** Port of `IdentityRoleUpdateDto`. */
export class IdentityRoleUpdateDto extends IdentityRoleCreateOrUpdateDtoBase {
  static readonly schema = z.object({ ...roleCreateOrUpdateShape, concurrencyStamp: z.string().nullish() });
  concurrencyStamp: string | undefined = undefined;
}

/** Port of `GetIdentityRolesInput`. */
export class GetIdentityRolesInput extends ExtensiblePagedAndSortedResultRequestDto {
  static override readonly schema = z.object({ ...pagedAndSortedShape, filter: z.string().nullish() });
  filter: string | undefined = undefined;
}

/** Port of `UserLookupSearchInputDto`. */
export class UserLookupSearchInputDto extends ExtensiblePagedAndSortedResultRequestDto {
  static override readonly schema = z.object({ ...pagedAndSortedShape, filter: z.string().nullish() });
  filter: string | undefined = undefined;
}

/** Port of `UserLookupCountInputDto`. */
export class UserLookupCountInputDto {
  static readonly schema = z.object({ filter: z.string().nullish() });
  filter: string | undefined = undefined;
}

/** Port of `RoleLookupSearchInputDto`. */
export class RoleLookupSearchInputDto extends ExtensiblePagedAndSortedResultRequestDto {
  static override readonly schema = z.object({ ...pagedAndSortedShape, filter: z.string().nullish() });
  filter: string | undefined = undefined;
}

/** Port of `RoleLookupCountInputDto`. */
export class RoleLookupCountInputDto {
  static readonly schema = z.object({ filter: z.string().nullish() });
  filter: string | undefined = undefined;
}
