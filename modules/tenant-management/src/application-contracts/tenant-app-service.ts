import { createToken, type Guid } from "@abp/core";
import type { ICrudAppService } from "@abp/ddd-application";
import type { GetTenantsInput, TenantCreateDto, TenantDto, TenantUpdateDto } from "./dtos.js";

/** Port of `ITenantAppService`. */
export interface ITenantAppService extends ICrudAppService<TenantDto, Guid, GetTenantsInput, TenantCreateDto, TenantUpdateDto> {
  getDefaultConnectionString(id: Guid): Promise<string | undefined>;
  updateDefaultConnectionString(id: Guid, defaultConnectionString: string): Promise<void>;
  deleteDefaultConnectionString(id: Guid): Promise<void>;
}
export const ITenantAppService = createToken<ITenantAppService>("ITenantAppService");
