import { BusinessException, Check, Transient, createToken } from "@abp/core";
import { TenantManagementErrorCodes } from "../domain-shared/index.js";
import { ITenantRepository } from "./tenant-repository.js";
import type { Tenant } from "./tenant.js";

/** Port of `ITenantValidator`. */
export interface ITenantValidator {
  validate(tenant: Tenant): Promise<void>;
}
export const ITenantValidator = createToken<ITenantValidator>("ITenantValidator");

/** Port of `AbpTenantValidator`: the normalized name must be unique. */
@Transient(ITenantValidator)
export class AbpTenantValidator implements ITenantValidator {
  static readonly inject = [ITenantRepository] as const;

  constructor(protected readonly tenantRepository: ITenantRepository) {}

  async validate(tenant: Tenant): Promise<void> {
    Check.notNullOrWhiteSpace(tenant.name, "name");
    const normalizedName = Check.notNullOrWhiteSpace(tenant.normalizedName, "normalizedName");

    const owner = await this.tenantRepository.findByName(normalizedName);
    if (owner !== undefined && owner.id !== tenant.id) {
      throw new BusinessException({ code: TenantManagementErrorCodes.DuplicateTenantName }).withData("Name", normalizedName);
    }
  }
}
