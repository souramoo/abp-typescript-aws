import { Transient, type Guid } from "@abp/core";
import { AbpControllerBase, Controller, HttpDelete, HttpGet, HttpPost, HttpPut, body, query, route } from "@abp/aws-lambda";
import type { PagedResultDto } from "@abp/ddd-application";
import { z } from "zod";
import { GetTenantsInput, ITenantAppService, TenantCreateDto, TenantManagementRemoteServiceConsts, TenantUpdateDto, type TenantDto } from "../application-contracts/index.js";

/** Port of `TenantController` (`api/multi-tenancy/tenants`, remote service `AbpTenantManagement`). */
@Transient()
@Controller("api/multi-tenancy/tenants", { remoteServiceName: TenantManagementRemoteServiceConsts.RemoteServiceName, area: TenantManagementRemoteServiceConsts.ModuleName })
export class TenantController extends AbpControllerBase implements ITenantAppService {
  static readonly inject = [ITenantAppService] as const;

  constructor(protected readonly tenantAppService: ITenantAppService) {
    super();
  }

  @HttpGet(":id", route("id", { type: "guid" }))
  get(id: Guid): Promise<TenantDto> {
    return this.tenantAppService.get(id);
  }

  @HttpGet("", query(GetTenantsInput))
  getList(input: GetTenantsInput): Promise<PagedResultDto<TenantDto>> {
    return this.tenantAppService.getList(input);
  }

  @HttpPost("", body(TenantCreateDto))
  create(input: TenantCreateDto): Promise<TenantDto> {
    this.validateModel();
    return this.tenantAppService.create(input);
  }

  @HttpPut(":id", route("id", { type: "guid" }), body(TenantUpdateDto))
  update(id: Guid, input: TenantUpdateDto): Promise<TenantDto> {
    return this.tenantAppService.update(id, input);
  }

  @HttpDelete(":id", route("id", { type: "guid" }))
  delete(id: Guid): Promise<void> {
    return this.tenantAppService.delete(id);
  }

  @HttpGet(":id/default-connection-string", route("id", { type: "guid" }))
  getDefaultConnectionString(id: Guid): Promise<string | undefined> {
    return this.tenantAppService.getDefaultConnectionString(id);
  }

  @HttpPut(":id/default-connection-string", route("id", { type: "guid" }), body(z.string()))
  updateDefaultConnectionString(id: Guid, defaultConnectionString: string): Promise<void> {
    return this.tenantAppService.updateDefaultConnectionString(id, defaultConnectionString);
  }

  @HttpDelete(":id/default-connection-string", route("id", { type: "guid" }))
  deleteDefaultConnectionString(id: Guid): Promise<void> {
    return this.tenantAppService.deleteDefaultConnectionString(id);
  }
}
