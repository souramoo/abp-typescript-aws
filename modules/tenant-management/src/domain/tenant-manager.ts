import { Check, Transient, createToken } from "@abp/core";
import { DomainService } from "@abp/ddd-domain";
import { ILocalEventBus } from "@abp/event-bus";
import { ITenantNormalizer, TenantChangedEvent } from "@abp/multi-tenancy-abstractions";
import { Tenant } from "./tenant.js";
import { ITenantValidator } from "./tenant-validator.js";

/** Port of `ITenantManager`. */
export interface ITenantManager {
  create(name: string): Promise<Tenant>;
  changeName(tenant: Tenant, name: string): Promise<void>;
}
export const ITenantManager = createToken<ITenantManager>("ITenantManager");

/** Port of `TenantManager`. */
@Transient(ITenantManager)
export class TenantManager extends DomainService implements ITenantManager {
  static readonly inject = [ITenantValidator, ITenantNormalizer, ILocalEventBus] as const;

  constructor(
    protected readonly tenantValidator: ITenantValidator,
    protected readonly tenantNormalizer: ITenantNormalizer,
    protected readonly localEventBus: ILocalEventBus,
  ) {
    super();
  }

  async create(name: string): Promise<Tenant> {
    Check.notNull(name, "name");

    const tenant = new Tenant(this.guidGenerator.create(), name, this.tenantNormalizer.normalizeName(name));
    await this.tenantValidator.validate(tenant);
    return tenant;
  }

  async changeName(tenant: Tenant, name: string): Promise<void> {
    Check.notNull(tenant, "tenant");
    Check.notNull(name, "name");

    await this.localEventBus.publish(new TenantChangedEvent(tenant.id, tenant.normalizedName));

    tenant.setName(name);
    tenant.setNormalizedName(this.tenantNormalizer.normalizeName(name));
    await this.tenantValidator.validate(tenant);
  }
}
