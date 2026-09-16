import { z } from "zod";

/** Port of `ProviderInfoDto`. */
export class ProviderInfoDto {
  providerName!: string;
  providerKey!: string;
}

/** Port of `PermissionGrantInfoDto`. */
export class PermissionGrantInfoDto {
  name!: string;
  displayName: string | undefined = undefined;
  parentName: string | undefined = undefined;
  isGranted = false;
  allowedProviders: string[] = [];
  grantedProviders: ProviderInfoDto[] = [];
  isEditable = true;
}

/** Port of `PermissionGroupDto`. */
export class PermissionGroupDto {
  name!: string;
  displayName: string | undefined = undefined;
  displayNameKey: string | undefined = undefined;
  displayNameResource: string | undefined = undefined;
  permissions: PermissionGrantInfoDto[] = [];
}

/** Port of `GetPermissionListResultDto`. */
export class GetPermissionListResultDto {
  entityDisplayName: string | undefined = undefined;
  groups: PermissionGroupDto[] = [];
}

/** Port of `UpdatePermissionDto`. */
export class UpdatePermissionDto {
  static readonly schema = z.object({ name: z.string().min(1), isGranted: z.boolean() });
  name!: string;
  isGranted = false;
}

/** Port of `UpdatePermissionsDto`. */
export class UpdatePermissionsDto {
  static readonly schema = z.object({ permissions: z.array(UpdatePermissionDto.schema).default([]) });
  permissions: UpdatePermissionDto[] = [];
}
