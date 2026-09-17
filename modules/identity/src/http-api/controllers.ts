import { Transient, type Guid } from "@abp/core";
import { AbpControllerBase, Controller, HttpDelete, HttpGet, HttpPost, HttpPut, body, query, route } from "@abp/aws-lambda";
import type { ListResultDto, PagedResultDto } from "@abp/ddd-application";
import type { RoleData, UserData } from "@abp/users/domain-shared";
import { z } from "zod";
import {
  GetIdentityRolesInput,
  GetIdentityUsersInput,
  IIdentityRoleAppService,
  IIdentityUserAppService,
  IIdentityUserIntegrationService,
  IIdentityUserLookupAppService,
  IdentityRemoteServiceConsts,
  IdentityRoleCreateDto,
  IdentityRoleUpdateDto,
  IdentityUserCreateDto,
  IdentityUserUpdateDto,
  IdentityUserUpdateRolesDto,
  RoleLookupCountInputDto,
  RoleLookupSearchInputDto,
  UserLookupCountInputDto,
  UserLookupSearchInputDto,
  type IdentityRoleDto,
  type IdentityUserDto,
} from "../application-contracts/index.js";

const controllerOptions = { remoteServiceName: IdentityRemoteServiceConsts.RemoteServiceName, area: IdentityRemoteServiceConsts.ModuleName };

/** Port of `IdentityUserController` (`api/identity/users`). */
@Transient()
@Controller("api/identity/users", controllerOptions)
export class IdentityUserController extends AbpControllerBase {
  static readonly inject = [IIdentityUserAppService] as const;

  constructor(protected readonly userAppService: IIdentityUserAppService) {
    super();
  }

  @HttpGet(":id", route("id", { type: "guid" }))
  get(id: Guid): Promise<IdentityUserDto> {
    return this.userAppService.get(id);
  }

  @HttpGet("", query(GetIdentityUsersInput))
  getList(input: GetIdentityUsersInput): Promise<PagedResultDto<IdentityUserDto>> {
    return this.userAppService.getList(input);
  }

  @HttpPost("", body(IdentityUserCreateDto))
  create(input: IdentityUserCreateDto): Promise<IdentityUserDto> {
    return this.userAppService.create(input);
  }

  @HttpPut(":id", route("id", { type: "guid" }), body(IdentityUserUpdateDto))
  update(id: Guid, input: IdentityUserUpdateDto): Promise<IdentityUserDto> {
    return this.userAppService.update(id, input);
  }

  @HttpDelete(":id", route("id", { type: "guid" }))
  delete(id: Guid): Promise<void> {
    return this.userAppService.delete(id);
  }

  @HttpGet("by-id/:id", route("id", { type: "guid" }))
  findById(id: Guid): Promise<IdentityUserDto | undefined> {
    return this.userAppService.findById(id);
  }

  @HttpGet(":id/roles", route("id", { type: "guid" }))
  getRoles(id: Guid): Promise<ListResultDto<IdentityRoleDto>> {
    return this.userAppService.getRoles(id);
  }

  @HttpGet("assignable-roles")
  getAssignableRoles(): Promise<ListResultDto<IdentityRoleDto>> {
    return this.userAppService.getAssignableRoles();
  }

  @HttpPut(":id/roles", route("id", { type: "guid" }), body(IdentityUserUpdateRolesDto))
  updateRoles(id: Guid, input: IdentityUserUpdateRolesDto): Promise<void> {
    return this.userAppService.updateRoles(id, input);
  }

  @HttpGet("by-username/:userName", route("userName"))
  findByUsername(userName: string): Promise<IdentityUserDto | undefined> {
    return this.userAppService.findByUsername(userName);
  }

  @HttpGet("by-email/:email", route("email"))
  findByEmail(email: string): Promise<IdentityUserDto | undefined> {
    return this.userAppService.findByEmail(email);
  }
}

/** Port of `IdentityRoleController` (`api/identity/roles`). */
@Transient()
@Controller("api/identity/roles", controllerOptions)
export class IdentityRoleController extends AbpControllerBase {
  static readonly inject = [IIdentityRoleAppService] as const;

  constructor(protected readonly roleAppService: IIdentityRoleAppService) {
    super();
  }

  @HttpGet("all")
  getAllList(): Promise<ListResultDto<IdentityRoleDto>> {
    return this.roleAppService.getAllList();
  }

  @HttpGet("", query(GetIdentityRolesInput))
  getList(input: GetIdentityRolesInput): Promise<PagedResultDto<IdentityRoleDto>> {
    return this.roleAppService.getList(input);
  }

  @HttpGet(":id", route("id", { type: "guid" }))
  get(id: Guid): Promise<IdentityRoleDto> {
    return this.roleAppService.get(id);
  }

  @HttpPost("", body(IdentityRoleCreateDto))
  create(input: IdentityRoleCreateDto): Promise<IdentityRoleDto> {
    return this.roleAppService.create(input);
  }

  @HttpPut(":id", route("id", { type: "guid" }), body(IdentityRoleUpdateDto))
  update(id: Guid, input: IdentityRoleUpdateDto): Promise<IdentityRoleDto> {
    return this.roleAppService.update(id, input);
  }

  @HttpDelete(":id", route("id", { type: "guid" }))
  delete(id: Guid): Promise<void> {
    return this.roleAppService.delete(id);
  }
}

/** Port of `IdentityUserLookupController` (`api/identity/users/lookup`). */
@Transient()
@Controller("api/identity/users/lookup", controllerOptions)
export class IdentityUserLookupController extends AbpControllerBase {
  static readonly inject = [IIdentityUserLookupAppService] as const;

  constructor(protected readonly lookupAppService: IIdentityUserLookupAppService) {
    super();
  }

  @HttpGet(":id", route("id", { type: "guid" }))
  findById(id: Guid): Promise<UserData | undefined> {
    return this.lookupAppService.findById(id);
  }

  @HttpGet("by-username/:userName", route("userName"))
  findByUserName(userName: string): Promise<UserData | undefined> {
    return this.lookupAppService.findByUserName(userName);
  }

  @HttpGet("search", query(UserLookupSearchInputDto))
  search(input: UserLookupSearchInputDto): Promise<ListResultDto<UserData>> {
    return this.lookupAppService.search(input);
  }

  @HttpGet("count", query(UserLookupCountInputDto))
  getCount(input: UserLookupCountInputDto): Promise<number> {
    return this.lookupAppService.getCount(input);
  }
}

const idsSchema = z.object({ ids: z.array(z.uuid()).default([]) });
const namesSchema = z.object({ names: z.array(z.string()).default([]) });

/** Port of `IdentityUserIntegrationController` (`integration-api/identity/users`). */
@Transient()
@Controller("integration-api/identity/users", controllerOptions)
export class IdentityUserIntegrationController extends AbpControllerBase {
  static readonly inject = [IIdentityUserIntegrationService] as const;

  constructor(protected readonly userIntegrationService: IIdentityUserIntegrationService) {
    super();
  }

  @HttpGet(":id/role-names", route("id", { type: "guid" }))
  getRoleNames(id: Guid): Promise<string[]> {
    return this.userIntegrationService.getRoleNames(id);
  }

  @HttpGet(":id", route("id", { type: "guid" }))
  findById(id: Guid): Promise<UserData | undefined> {
    return this.userIntegrationService.findById(id);
  }

  @HttpGet("by-username/:userName", route("userName"))
  findByUserName(userName: string): Promise<UserData | undefined> {
    return this.userIntegrationService.findByUserName(userName);
  }

  @HttpGet("search", query(UserLookupSearchInputDto))
  search(input: UserLookupSearchInputDto): Promise<ListResultDto<UserData>> {
    return this.userIntegrationService.search(input);
  }

  @HttpGet("search/by-ids", query(idsSchema))
  searchByIds(input: z.infer<typeof idsSchema>): Promise<ListResultDto<UserData>> {
    return this.userIntegrationService.searchByIds(input.ids);
  }

  @HttpGet("count", query(UserLookupCountInputDto))
  getCount(input: UserLookupCountInputDto): Promise<number> {
    return this.userIntegrationService.getCount(input);
  }

  @HttpGet("search/roles", query(RoleLookupSearchInputDto))
  searchRole(input: RoleLookupSearchInputDto): Promise<ListResultDto<RoleData>> {
    return this.userIntegrationService.searchRole(input);
  }

  @HttpGet("search/roles/by-names", query(namesSchema))
  searchRoleByNames(input: z.infer<typeof namesSchema>): Promise<ListResultDto<RoleData>> {
    return this.userIntegrationService.searchRoleByNames(input.names);
  }

  @HttpGet("count/roles", query(RoleLookupCountInputDto))
  getRoleCount(input: RoleLookupCountInputDto): Promise<number> {
    return this.userIntegrationService.getRoleCount(input);
  }
}
