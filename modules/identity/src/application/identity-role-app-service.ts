import { Transient, type Guid } from "@abp/core";
import { Authorize } from "@abp/authorization";
import { setConcurrencyStampIfNotNull } from "@abp/data";
import { ListResultDto, PagedResultDto } from "@abp/ddd-application";
import { mapExtraPropertiesTo } from "@abp/object-extending";
import type { GetIdentityRolesInput, IdentityRoleCreateDto, IdentityRoleUpdateDto } from "../application-contracts/index.js";
import { IIdentityRoleAppService, IdentityPermissions, IdentityRoleDto } from "../application-contracts/index.js";
import { IIdentityRoleRepository, IdentityRole, IdentityRoleManager } from "../domain/index.js";
import { IdentityAppServiceBase } from "./identity-app-service-base.js";

/** Port of `IdentityRoleAppService`. */
@Transient(IIdentityRoleAppService)
@Authorize(IdentityPermissions.Roles.Default)
export class IdentityRoleAppService extends IdentityAppServiceBase implements IIdentityRoleAppService {
  static readonly inject = [IdentityRoleManager, IIdentityRoleRepository] as const;

  constructor(
    protected readonly roleManager: IdentityRoleManager,
    protected readonly roleRepository: IIdentityRoleRepository,
  ) {
    super();
  }

  async get(id: Guid): Promise<IdentityRoleDto> {
    return this.mapRole(await this.roleManager.getById(id));
  }

  async getAllList(): Promise<ListResultDto<IdentityRoleDto>> {
    const list = await this.roleRepository.getList();
    return new ListResultDto(list.map((role) => this.mapRole(role)));
  }

  async getList(input: GetIdentityRolesInput): Promise<PagedResultDto<IdentityRoleDto>> {
    const filter = input.filter ?? undefined;
    const list = await this.roleRepository.getList({ sorting: input.sorting ?? undefined, maxResultCount: input.maxResultCount, skipCount: input.skipCount, filter });
    const totalCount = await this.roleRepository.getCount(filter);
    return new PagedResultDto(totalCount, list.map((role) => this.mapRole(role)));
  }

  @Authorize(IdentityPermissions.Roles.Create)
  async create(input: IdentityRoleCreateDto): Promise<IdentityRoleDto> {
    const role = new IdentityRole(this.guidGenerator.create(), input.name, this.currentTenant.id);
    role.isDefault = input.isDefault;
    role.isPublic = input.isPublic;
    mapExtraPropertiesTo(input, role);
    (await this.roleManager.create(role)).checkErrors();
    await this.currentUnitOfWork?.saveChanges();
    return this.mapRole(role);
  }

  @Authorize(IdentityPermissions.Roles.Update)
  async update(id: Guid, input: IdentityRoleUpdateDto): Promise<IdentityRoleDto> {
    const role = await this.roleManager.getById(id);
    setConcurrencyStampIfNotNull(role, input.concurrencyStamp);
    if (role.name !== input.name) (await this.roleManager.setRoleName(role, input.name)).checkErrors();
    role.isDefault = input.isDefault;
    role.isPublic = input.isPublic;
    mapExtraPropertiesTo(input, role);
    (await this.roleManager.update(role)).checkErrors();
    await this.currentUnitOfWork?.saveChanges();
    return this.mapRole(role);
  }

  @Authorize(IdentityPermissions.Roles.Delete)
  async delete(id: Guid): Promise<void> {
    const role = await this.roleManager.findById(id);
    if (!role) return;
    (await this.roleManager.delete(role)).checkErrors();
  }

  protected mapRole(role: IdentityRole): IdentityRoleDto {
    return this.objectMapper.map(IdentityRole, IdentityRoleDto, role);
  }
}
