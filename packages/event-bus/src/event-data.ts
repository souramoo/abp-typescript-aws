import { AbpException, Check, Guid, isNullOrWhiteSpace } from "@abp/core";

/** Port of `EventBusConsts`. */
export const EventBusConsts = {
  CorrelationIdHeaderName: "X-Correlation-Id",
  TenantIdHeaderName: "X-Tenant-Id",
} as const;

/** Port of `EventBusTenantIdHelper`: throws for an unparsable value so a provider can fail the message. */
export const EventBusTenantIdHelper = {
  parse(value: string | null | undefined): Guid | undefined {
    if (isNullOrWhiteSpace(value)) return undefined;
    if (!Guid.isValid(value)) throw new AbpException(`'${EventBusConsts.TenantIdHeaderName}' header of the distributed event was not a valid GUID: ${value}`);
    return Guid.parse(value);
  },
};

/** Result of `IEventDataMayHaveTenantId.isMultiTenant` (port of the `bool` + `out Guid?` pair). */
export type MultiTenantEventDataInfo = { readonly isMultiTenant: true; readonly tenantId: Guid | undefined } | { readonly isMultiTenant: false };

/** Port of `IEventDataMayHaveTenantId`: an event that may (or may not) carry tenant information. */
export interface IEventDataMayHaveTenantId {
  isMultiTenant(): MultiTenantEventDataInfo;
}

export function isEventDataMayHaveTenantId(value: unknown): value is IEventDataMayHaveTenantId {
  return typeof value === "object" && value !== null && typeof (value as IEventDataMayHaveTenantId).isMultiTenant === "function";
}

/** Port of `DynamicEventData`: wraps arbitrary data with a string event name for type-less event handling. */
export class DynamicEventData implements IEventDataMayHaveTenantId {
  readonly eventName: string;
  readonly data: object;
  #tenantId: Guid | undefined;
  #hasTenantId = false;

  constructor(eventName: string, data: object) {
    this.eventName = Check.notNullOrWhiteSpace(eventName, "eventName");
    this.data = Check.notNull(data, "data");
  }

  /** `data` is user data, so the tenant id can only come from the transport. */
  setTenantId(tenantId: Guid | undefined): this {
    this.#tenantId = tenantId;
    this.#hasTenantId = true;
    return this;
  }

  isMultiTenant(): MultiTenantEventDataInfo {
    return this.#hasTenantId ? { isMultiTenant: true, tenantId: this.#tenantId } : { isMultiTenant: false };
  }
}

/** Port of `EtoBase` (`Volo.Abp.Domain.Entities.Events.Distributed`). */
export abstract class EtoBase {
  properties: Record<string, string> = {};
}

/** Port of `System.AggregateException` as thrown by `EventBusBase.ThrowOriginalExceptions`. */
export class AggregateException extends AbpException {
  constructor(
    message: string,
    readonly innerExceptions: readonly unknown[],
  ) {
    super(message, { cause: innerExceptions[0] });
  }
}
