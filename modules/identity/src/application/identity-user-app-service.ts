import { BusinessException, Transient, isNullOrEmptyString, type Guid } from "@abp/core";
import { Authorize, IPermissionChecker } from "@abp/authorization";
import { ListResultDto, PagedResultDto } from "@abp/ddd-application";
import { mapExtraPropertiesTo } from "@abp/object-extending";
import { AbpRoleConsts, getId } from "@abp/security";
import { setConcurrencyStampIfNotNull } from "@abp/data";
import type { GetIdentityUsersInput, IdentityUserCreateDto, IdentityUserUpdateDto, IdentityUserUpdateRolesDto} from "../application-contracts/index.js";
import { IIdentityUserAppService, IdentityRoleDto, IdentityUserDto, IdentityPermissions, type IdentityUserCreateOrUpdateDtoBase } from "../application-contracts/index.js";
import { IdentityErrorCodes } from "../domain-shared/index.js";
import { IIdentityRoleRepository, IIdentityUserRepository, IdentityRole, IdentityUser, IdentityUserManager } from "../domain/index.js";
import { IdentityAppServiceBase } from "./identity-app-service-base.js";

/** Port of `IdentityUserAppService`. */
@Transient(IIdentityUserAppService)
export class IdentityUserAppService extends IdentityAppServiceBase implements IIdentityUserAppService {
  static readonly inject = [IdentityUserManager, IIdentityUserRepository, IIdentityRoleRepository, IPermissionChecker] as const;

  constructor(
    protected readonly userManager: IdentityUserManager,
    protected readonly userRepository: IIdentityUserRepository,
    protected readonly roleRepository: IIdentityRoleRepository,
    protected readonly permissionChecker: IPermissionChecker,
  ) {
    super();
  }

  @Authorize(IdentityPermissions.Users.Default)
  async get(id: Guid): Promise<IdentityUserDto> {
    return this.mapUser(await this.userManager.getById(id));
  }

  @Authorize(IdentityPermissions.Users.Default)
  async getList(input: GetIdentityUsersInput): Promise<PagedResultDto<IdentityUserDto>> {
    const filter = input.filter ?? undefined;
    const count = await this.userRepository.getCount({ filter });
    const list = await this.userRepository.getList({ sorting: input.sorting ?? undefined, maxResultCount: input.maxResultCount, skipCount: input.skipCount, filter });
    return new PagedResultDto(count, list.map((user) => this.mapUser(user)));
  }

  @Authorize(IdentityPermissions.Users.Default)
  async getRoles(id: Guid): Promise<ListResultDto<IdentityRoleDto>> {
    const roles = (await this.userRepository.getRoles(id)).sort(byName);
    return new ListResultDto(roles.map((role) => this.mapRole(role)));
  }

  @Authorize(IdentityPermissions.Users.Default)
  async getAssignableRoles(): Promise<ListResultDto<IdentityRoleDto>> {
    let list: IdentityRole[];
    if (await this.hasAdminRole()) {
      list = (await this.roleRepository.getList()).sort(byName);
    } else {
      const currentUserRoles = await this.userManager.getRoles(await this.userManager.getById(getId(this.currentUser)));
      list = (await this.roleRepository.getListByNames(currentUserRoles)).sort(byName);
    }
    return new ListResultDto(list.map((role) => this.mapRole(role)));
  }

  @Authorize(IdentityPermissions.Users.Create)
  async create(input: IdentityUserCreateDto): Promise<IdentityUserDto> {
    const user = new IdentityUser(this.guidGenerator.create(), input.userName, input.email, this.currentTenant.id);
    mapExtraPropertiesTo(input, user);
    (await this.userManager.create(user, input.password)).checkErrors();
    await this.updateUserByInput(user, input);
    (await this.userManager.update(user)).checkErrors();
    await this.currentUnitOfWork?.saveChanges();
    return this.mapUser(user);
  }

  @Authorize(IdentityPermissions.Users.Update)
  async update(id: Guid, input: IdentityUserUpdateDto): Promise<IdentityUserDto> {
    const user = await this.userManager.getById(id);
    setConcurrencyStampIfNotNull(user, input.concurrencyStamp);
    (await this.userManager.setUserName(user, input.userName)).checkErrors();
    await this.updateUserByInput(user, input);
    mapExtraPropertiesTo(input, user);
    (await this.userManager.update(user)).checkErrors();
    if (!isNullOrEmptyString(input.password)) {
      (await this.userManager.removePassword(user)).checkErrors();
      (await this.userManager.addPassword(user, input.password)).checkErrors();
    }
    await this.currentUnitOfWork?.saveChanges();
    return this.mapUser(user);
  }

  @Authorize(IdentityPermissions.Users.Delete)
  async delete(id: Guid): Promise<void> {
    if (this.currentUser.id === id) throw new BusinessException({ code: IdentityErrorCodes.UserSelfDeletion });
    const user = await this.userManager.findById(id);
    if (!user) return;
    (await this.userManager.delete(user)).checkErrors();
  }

  @Authorize(IdentityPermissions.Users.Update)
  async updateRoles(id: Guid, input: IdentityUserUpdateRolesDto): Promise<void> {
    const user = await this.userManager.getById(id);
    const effectiveRoles = await this.filterRolesByCurrentUser(user, input.roleNames);
    (await this.userManager.setRoles(user, effectiveRoles)).checkErrors();
    await this.userRepository.update(user);
  }

  @Authorize(IdentityPermissions.Users.Default)
  async findByUsername(userName: string): Promise<IdentityUserDto | undefined> {
    const user = await this.userManager.findByName(userName);
    return user === undefined ? undefined : this.mapUser(user);
  }

  @Authorize(IdentityPermissions.Users.Default)
  async findByEmail(email: string): Promise<IdentityUserDto | undefined> {
    const user = await this.userManager.findByEmail(email);
    return user === undefined ? undefined : this.mapUser(user);
  }

  @Authorize(IdentityPermissions.Users.Default)
  async findById(id: Guid): Promise<IdentityUserDto | undefined> {
    const user = await this.userManager.findById(id);
    return user === undefined ? undefined : this.mapUser(user);
  }

  protected async updateUserByInput(user: IdentityUser, input: IdentityUserCreateOrUpdateDtoBase): Promise<void> {
    if (user.email.toLowerCase() !== input.email.toLowerCase()) (await this.userManager.setEmail(user, input.email)).checkErrors();
    if ((user.phoneNumber ?? "").toLowerCase() !== (input.phoneNumber ?? "").toLowerCase()) (await this.userManager.setPhoneNumber(user, input.phoneNumber ?? undefined)).checkErrors();
    (await this.userManager.setLockoutEnabled(user, input.lockoutEnabled)).checkErrors();
    if (user.id !== this.currentUser.id) user.setIsActive(input.isActive);
    user.name = input.name?.trim();
    user.surname = input.surname?.trim();
    (await this.userManager.update(user)).checkErrors();
    if (input.roleNames !== undefined && input.roleNames !== null && (await this.permissionChecker.isGranted(IdentityPermissions.Users.ManageRoles))) {
      const effectiveRoles = await this.filterRolesByCurrentUser(user, input.roleNames);
      (await this.userManager.setRoles(user, effectiveRoles)).checkErrors();
    }
  }

  /** Port of `FilterRolesByCurrentUserAsync`: non-admins can only assign roles they hold themselves and never touch the rest. */
  protected async filterRolesByCurrentUser(user: IdentityUser, inputRoleNames: readonly string[] | undefined): Promise<string[]> {
    const distinctIgnoreCase = (names: Iterable<string>) => [...new Map([...names].map((n) => [n.toLowerCase(), n])).values()];
    if (await this.hasAdminRole()) return distinctIgnoreCase(inputRoleNames ?? []);

    const lower = (names: Iterable<string>) => new Set([...names].map((n) => n.toLowerCase()));
    const targetCurrentRoles = await this.userManager.getRoles(user);
    const operatorUser = await this.userManager.getById(getId(this.currentUser));
    const operatorOwnRoleSet = lower(await this.userManager.getRoles(operatorUser));
    const inputRoleNameSet = lower(inputRoleNames ?? []);
    const keepUnmanageableRoles = targetCurrentRoles.filter((name) => !operatorOwnRoleSet.has(name.toLowerCase()));
    const desiredManageableRoles = [...(inputRoleNames ?? [])].filter((name) => inputRoleNameSet.has(name.toLowerCase()) && operatorOwnRoleSet.has(name.toLowerCase()));
    return distinctIgnoreCase([...keepUnmanageableRoles, ...desiredManageableRoles]);
  }

  protected async hasAdminRole(): Promise<boolean> {
    return this.currentUser.isInRole(AbpRoleConsts.adminRoleName);
  }

  protected mapUser(user: IdentityUser): IdentityUserDto {
    return this.objectMapper.map(IdentityUser, IdentityUserDto, user);
  }

  protected mapRole(role: IdentityRole): IdentityRoleDto {
    return this.objectMapper.map(IdentityRole, IdentityRoleDto, role);
  }
}

function byName(a: IdentityRole, b: IdentityRole): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
