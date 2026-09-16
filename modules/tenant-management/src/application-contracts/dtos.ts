import type { Guid } from "@abp/core";
import { DisableAuditing } from "@abp/auditing";
import type { IHasConcurrencyStamp } from "@abp/data";
import { ExtensibleEntityDto, PagedAndSortedResultRequestDto } from "@abp/ddd-application";
import { ExtensibleObject } from "@abp/object-extending";
import { z } from "zod";
import { TenantConsts } from "../domain-shared/index.js";

/** Port of `TenantDto`. */
export class TenantDto extends ExtensibleEntityDto<Guid> implements IHasConcurrencyStamp {
  name = "";
  concurrencyStamp = "";
}

/** Port of `GetTenantsInput` (paging defaults apply when the query string omits them, like the .NET DTO defaults). */
export class GetTenantsInput extends PagedAndSortedResultRequestDto {
  static override readonly schema: z.ZodType = z.object({
    filter: z.string().optional(),
    sorting: z.string().nullish(),
    skipCount: z.number().int().min(0).default(0),
    maxResultCount: z.number().int().min(1).default(PagedAndSortedResultRequestDto.defaultMaxResultCount),
  });

  filter: string | undefined = undefined;
}

/** `[DynamicStringLength(typeof(TenantConsts), nameof(TenantConsts.MaxNameLength))]`: the limit is read at validation time. */
const tenantName = z
  .string()
  .min(1)
  .refine((value) => value.length <= TenantConsts.maxNameLength, { message: `The field Name must be a string with a maximum length of ${TenantConsts.maxNameLength}.` });

/** Port of `TenantCreateOrUpdateDtoBase`. */
export abstract class TenantCreateOrUpdateDtoBase extends ExtensibleObject {
  static readonly schema: z.ZodType = z.object({ name: tenantName });

  name = "";

  constructor() {
    super(false);
  }
}

/** Port of `TenantCreateDto`. */
export class TenantCreateDto extends TenantCreateOrUpdateDtoBase {
  static override readonly schema: z.ZodType = z.object({
    name: tenantName,
    adminEmailAddress: z.email().refine((value) => value.length <= TenantConsts.maxAdminEmailAddressLength, { message: `The field AdminEmailAddress must be a string with a maximum length of ${TenantConsts.maxAdminEmailAddressLength}.` }),
    adminPassword: z
      .string()
      .min(1)
      .refine((value) => value.length <= TenantConsts.maxPasswordLength, { message: `The field AdminPassword must be a string with a maximum length of ${TenantConsts.maxPasswordLength}.` }),
  });

  adminEmailAddress = "";
  @DisableAuditing()
  adminPassword = "";
}

/** Port of `TenantUpdateDto`. */
export class TenantUpdateDto extends TenantCreateOrUpdateDtoBase implements IHasConcurrencyStamp {
  static override readonly schema: z.ZodType = z.object({ name: tenantName, concurrencyStamp: z.string().nullish() });

  concurrencyStamp = "";
}
