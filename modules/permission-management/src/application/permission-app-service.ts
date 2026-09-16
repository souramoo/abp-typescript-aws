import { AbpException, LocalizableString, Transient, isNullOrEmptyString, isNullOrWhiteSpace, optionsToken, type IOptions, type ISimpleStateCheckerManager } from "@abp/core";
import { Authorize, IPermissionChecker, IPermissionDefinitionManager, IPermissionStateCheckerManager, PermissionGrantResult, type PermissionDefinition, type PermissionGroupDefinition } from "@abp/authorization";
import { ApplicationService } from "@abp/ddd-application";
import { LocalizationResourceNameAttribute } from "@abp/localization";
import { ICurrentTenant, getMultiTenancySide, hasMultiTenancySide } from "@abp/multi-tenancy-abstractions";
import { AbpRoleConsts } from "@abp/security";
import { GetPermissionListResultDto, IPermissionAppService, PermissionGrantInfoDto, PermissionGroupDto, ProviderInfoDto, type UpdatePermissionsDto } from "../application-contracts/index.js";
import { AbpPermissionManagementResource } from "../domain-shared/index.js";
import { IPermissionManager, PermissionManagementOptions, type PermissionWithGrantedProviders } from "../domain/index.js";

/** Port of `PermissionAppService` (resource permission members not ported; see `IPermissionAppService`). */
@Transient(IPermissionAppService)
@Authorize()
export class PermissionAppService extends ApplicationService implements IPermissionAppService {
  static readonly inject = [IPermissionManager, IPermissionChecker, IPermissionDefinitionManager, optionsToken(PermissionManagementOptions), IPermissionStateCheckerManager, ICurrentTenant] as const;
  protected readonly options: PermissionManagementOptions;

  constructor(
    protected readonly permissionManager: IPermissionManager,
    protected readonly permissionChecker: IPermissionChecker,
    protected readonly permissionDefinitionManager: IPermissionDefinitionManager,
    options: IOptions<PermissionManagementOptions>,
    protected readonly simpleStateCheckerManager: ISimpleStateCheckerManager<PermissionDefinition>,
    protected readonly tenant: ICurrentTenant,
  ) {
    super();
    this.localizationResource = AbpPermissionManagementResource;
    this.options = options.value;
  }

  async get(providerName: string, providerKey: string): Promise<GetPermissionListResultDto> {
    return this.getInternal(undefined, providerName, providerKey);
  }

  async getByGroup(groupName: string, providerName: string, providerKey: string): Promise<GetPermissionListResultDto> {
    return this.getInternal(groupName, providerName, providerKey);
  }

  protected async getInternal(groupName: string | undefined, providerName: string, providerKey: string): Promise<GetPermissionListResultDto> {
    await this.checkProviderPolicy(providerName);

    const result = new GetPermissionListResultDto();
    result.entityDisplayName = providerKey;

    const multiTenancySide = getMultiTenancySide(this.tenant);
    const permissionGroups: PermissionGroupDto[] = [];

    const groups = (await this.permissionDefinitionManager.getGroups()).filter((x) => isNullOrWhiteSpace(groupName) || x.name === groupName);
    for (const group of groups) {
      const groupDto = this.createPermissionGroupDto(group);
      const candidatePermissions = [...new Set(group.getPermissionsWithChildren().filter((x) => x.isEnabled && (x.providers.length === 0 || x.providers.includes(providerName)) && hasMultiTenancySide(x.multiTenancySide, multiTenancySide)))];
      const childrenByParent = new Map<PermissionDefinition, PermissionDefinition[]>();
      for (const permission of candidatePermissions) {
        if (!permission.parent) continue;
        childrenByParent.set(permission.parent, [...(childrenByParent.get(permission.parent) ?? []), permission]);
      }

      /* The state checkers of a permission only run when its parent is enabled, so each tree level is checked in its own batch. */
      const enabledPermissions = new Set<PermissionDefinition>();
      let currentLevel = candidatePermissions.filter((x) => !x.parent);
      while (currentLevel.length > 0) {
        const levelResult = await this.simpleStateCheckerManager.isEnabledMany(currentLevel);
        const enabledLevelPermissions = currentLevel.filter((x) => levelResult.get(x) === true);
        for (const permission of enabledLevelPermissions) enabledPermissions.add(permission);
        currentLevel = enabledLevelPermissions.flatMap((x) => childrenByParent.get(x) ?? []);
      }

      const neededCheckPermissions = candidatePermissions.filter((x) => enabledPermissions.has(x));
      if (neededCheckPermissions.length === 0) continue;

      groupDto.permissions.push(...neededCheckPermissions.map((p) => this.createPermissionGrantInfoDto(p)));
      permissionGroups.push(groupDto);
    }

    const multipleGrantInfo = await this.permissionManager.get(
      permissionGroups.flatMap((group) => group.permissions).map((permission) => permission.name),
      providerName,
      providerKey,
    );
    const grantInfoByName = new Map<string, PermissionWithGrantedProviders>();
    for (const grantInfo of multipleGrantInfo.result) if (!grantInfoByName.has(grantInfo.name)) grantInfoByName.set(grantInfo.name, grantInfo);

    for (const permissionGroup of permissionGroups) {
      for (const permission of permissionGroup.permissions) {
        const grantInfo = grantInfoByName.get(permission.name);
        if (!grantInfo) continue;
        permission.isGranted = grantInfo.isGranted;
        permission.grantedProviders = grantInfo.providers.map((x) => Object.assign(new ProviderInfoDto(), { providerName: x.name, providerKey: x.key }));
      }
      if (permissionGroup.permissions.length > 0) result.groups.push(permissionGroup);
    }

    await this.filterOutputPermissionsByCurrentUser(result);
    return result;
  }

  /** Non-admin users may only edit the permissions they hold themselves. */
  protected async filterOutputPermissionsByCurrentUser(result: GetPermissionListResultDto): Promise<void> {
    if (await this.hasAdminRole()) return;
    const allPermissionNames = result.groups.flatMap((g) => g.permissions).map((p) => p.name);
    if (allPermissionNames.length === 0) return;

    const currentUserPermissions = await this.permissionChecker.isGranted(allPermissionNames);
    const grantedPermissionNames = new Set([...currentUserPermissions.result].filter(([, grant]) => grant === PermissionGrantResult.Granted).map(([name]) => name));
    for (const group of result.groups) {
      for (const permission of group.permissions) permission.isEditable = grantedPermissionNames.has(permission.name);
    }
  }

  protected createPermissionGrantInfoDto(permission: PermissionDefinition): PermissionGrantInfoDto {
    const dto = new PermissionGrantInfoDto();
    dto.name = permission.name;
    dto.displayName = permission.displayName.localize(this.stringLocalizerFactory).value;
    dto.parentName = permission.parent?.name;
    dto.allowedProviders = [...permission.providers];
    dto.grantedProviders = [];
    dto.isEditable = true;
    return dto;
  }

  protected createPermissionGroupDto(group: PermissionGroupDefinition): PermissionGroupDto {
    const localizableDisplayName = group.displayName instanceof LocalizableString ? group.displayName : undefined;
    const dto = new PermissionGroupDto();
    dto.name = group.name;
    dto.displayName = group.displayName.localize(this.stringLocalizerFactory).value;
    dto.displayNameKey = localizableDisplayName?.name;
    dto.displayNameResource = localizableDisplayName ? LocalizationResourceNameAttribute.getName(localizableDisplayName.resource) : undefined;
    dto.permissions = [];
    return dto;
  }

  async update(providerName: string, providerKey: string, input: UpdatePermissionsDto): Promise<void> {
    await this.checkProviderPolicy(providerName);
    await this.filterInputPermissionsByCurrentUser(input);
    for (const permissionDto of input.permissions) await this.permissionManager.set(permissionDto.name, providerName, providerKey, permissionDto.isGranted);
  }

  protected async checkProviderPolicy(providerName: string): Promise<void> {
    const policyName = this.options.providerPolicies.get(providerName);
    if (isNullOrEmptyString(policyName)) throw new AbpException(`No policy defined to get/set permissions for the provider '${providerName}'. Use PermissionManagementOptions to map the policy.`);
    await this.authorizationService.check(policyName);
  }

  /** Filters the input in place to the permissions the (non-admin) current user holds. */
  protected async filterInputPermissionsByCurrentUser(input: UpdatePermissionsDto): Promise<void> {
    if (await this.hasAdminRole()) return;
    if (input.permissions.length === 0) return;

    const currentUserPermissions = await this.permissionChecker.isGranted(input.permissions.map((p) => p.name));
    const grantedPermissions = new Set([...currentUserPermissions.result].filter(([, grant]) => grant === PermissionGrantResult.Granted).map(([name]) => name));
    input.permissions = input.permissions.filter((x) => grantedPermissions.has(x.name));
  }

  protected async hasAdminRole(): Promise<boolean> {
    return this.currentUser.isInRole(AbpRoleConsts.adminRoleName);
  }
}
