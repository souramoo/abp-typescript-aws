import { Transient, type Guid } from "@abp/core";
import { distributedCacheToken, type IDistributedCache } from "@abp/caching";
import { EntityChangedEventData, EntityCreatedEventData } from "@abp/ddd-domain";
import { LocalEventHandler, LocalEventHandlerOrder, type IEventHandler } from "@abp/event-bus";
import { TenantChangedEvent } from "@abp/multi-tenancy-abstractions";
import { Tenant } from "./tenant.js";
import { TenantConfigurationCacheItem } from "./tenant-configuration-cache-item.js";

/** Port of `TenantConfigurationCacheItemInvalidator`: clears the cached configuration when a tenant changes. */
@Transient()
@LocalEventHandler(EntityChangedEventData.of(Tenant), TenantChangedEvent)
@LocalEventHandlerOrder(-1)
export class TenantConfigurationCacheItemInvalidator implements IEventHandler<EntityChangedEventData<Tenant> | TenantChangedEvent> {
  static readonly inject = [distributedCacheToken(TenantConfigurationCacheItem)] as const;

  constructor(protected readonly cache: IDistributedCache<TenantConfigurationCacheItem>) {}

  async handleEvent(eventData: EntityChangedEventData<Tenant> | TenantChangedEvent): Promise<void> {
    if (eventData instanceof TenantChangedEvent) {
      await this.clearCache(eventData.id, eventData.normalizedName);
      return;
    }
    if (isTenantCreatedEvent(eventData)) return;
    await this.clearCache(eventData.entity.id, eventData.entity.normalizedName);
  }

  protected async clearCache(id: Guid | undefined, normalizedName: string | undefined): Promise<void> {
    await this.cache.removeMany(
      [
        TenantConfigurationCacheItem.calculateCacheKey(id, undefined),
        TenantConfigurationCacheItem.calculateCacheKey(undefined, normalizedName),
        TenantConfigurationCacheItem.calculateCacheKey(id, normalizedName),
      ],
      { considerUow: true },
    );
  }
}

function isTenantCreatedEvent(eventData: object): boolean {
  return eventData instanceof EntityCreatedEventData.of(Tenant);
}
