import { Transient } from "@abp/core";
import { AbpControllerBase, Controller, HttpGet, HttpPost, HttpPut, body, query } from "@abp/aws-lambda";
import type { ListResultDto } from "@abp/ddd-application";
import { z } from "zod";
import { IPermissionAppService, IPermissionIntegrationService, PermissionManagementRemoteServiceConsts, UpdatePermissionsDto, type GetPermissionListResultDto } from "../application-contracts/index.js";
import { IsGrantedRequest, type IsGrantedResponse } from "../domain-shared/index.js";

/** Port of `PermissionsController` (`api/permission-management/permissions`). */
@Transient()
@Controller("api/permission-management/permissions", { remoteServiceName: PermissionManagementRemoteServiceConsts.RemoteServiceName, area: PermissionManagementRemoteServiceConsts.ModuleName })
export class PermissionsController extends AbpControllerBase {
  static readonly inject = [IPermissionAppService] as const;

  constructor(protected readonly permissionAppService: IPermissionAppService) {
    super();
  }

  @HttpGet("", query("providerName", { optional: false }), query("providerKey", { optional: false }))
  get(providerName: string, providerKey: string): Promise<GetPermissionListResultDto> {
    return this.permissionAppService.get(providerName, providerKey);
  }

  @HttpGet("by-group", query("groupName", { optional: false }), query("providerName", { optional: false }), query("providerKey", { optional: false }))
  getByGroup(groupName: string, providerName: string, providerKey: string): Promise<GetPermissionListResultDto> {
    return this.permissionAppService.getByGroup(groupName, providerName, providerKey);
  }

  @HttpPut("", query("providerName", { optional: false }), query("providerKey", { optional: false }), body(UpdatePermissionsDto))
  update(providerName: string, providerKey: string, input: UpdatePermissionsDto): Promise<void> {
    return this.permissionAppService.update(providerName, providerKey, input);
  }
}

const isGrantedRequestsSchema = z.array(IsGrantedRequest.schema);

/** Port of `PermissionIntegrationController` (`integration-api/permission-management/permissions`). */
@Transient()
@Controller("integration-api/permission-management/permissions", { remoteServiceName: PermissionManagementRemoteServiceConsts.RemoteServiceName, area: PermissionManagementRemoteServiceConsts.ModuleName })
export class PermissionIntegrationController extends AbpControllerBase {
  static readonly inject = [IPermissionIntegrationService] as const;

  constructor(protected readonly permissionIntegrationService: IPermissionIntegrationService) {
    super();
  }

  @HttpPost("is-granted", body(isGrantedRequestsSchema))
  isGranted(input: IsGrantedRequest[]): Promise<ListResultDto<IsGrantedResponse>> {
    return this.permissionIntegrationService.isGranted(input.map((item) => Object.assign(new IsGrantedRequest(), item)));
  }
}
