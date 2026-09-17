import { isNullOrWhiteSpace, type Guid } from "@abp/core";
import { BasicAggregateRoot } from "@abp/ddd-domain";
import type { IMultiTenant } from "@abp/multi-tenancy-abstractions";
import { ExtraPropertyDictionary, setDefaultsForExtraProperties, type IHasExtraProperties } from "@abp/object-extending";
import { IdentitySessionConsts } from "../domain-shared/index.js";

export interface IdentitySessionInit {
  id: Guid;
  sessionId: string;
  device: string;
  deviceInfo?: string;
  userId: Guid;
  tenantId?: Guid;
  clientId?: string;
  ipAddresses?: string;
  signedIn: Date;
  lastAccessed?: Date;
}

/** Port of `IdentitySession`: one signed-in session of a user (the `session_id` claim points at `sessionId`). */
export class IdentitySession extends BasicAggregateRoot<Guid> implements IHasExtraProperties, IMultiTenant {
  sessionId!: string;
  device!: string;
  deviceInfo: string | undefined = undefined;
  tenantId: Guid | undefined = undefined;
  userId!: Guid;
  clientId: string | undefined = undefined;
  ipAddresses: string | undefined = undefined;
  signedIn!: Date;
  lastAccessed: Date | undefined = undefined;
  extraProperties: ExtraPropertyDictionary = new ExtraPropertyDictionary();

  constructor(init?: IdentitySessionInit) {
    super(init?.id);
    if (init) {
      this.sessionId = init.sessionId;
      this.device = init.device;
      this.deviceInfo = init.deviceInfo;
      this.userId = init.userId;
      this.tenantId = init.tenantId;
      this.clientId = init.clientId;
      this.ipAddresses = init.ipAddresses;
      this.signedIn = init.signedIn;
      this.lastAccessed = init.lastAccessed;
    }
    setDefaultsForExtraProperties(this, new.target);
  }

  setSignedInTime(signedIn: Date): void {
    this.signedIn = signedIn;
  }

  updateLastAccessedTime(lastAccessed: Date | undefined): void {
    this.lastAccessed = lastAccessed;
  }

  setIpAddresses(ipAddresses: Iterable<string>): void {
    this.ipAddresses = joinAsString([...ipAddresses]);
  }

  getIpAddresses(): string[] {
    return this.ipAddresses?.split(",").filter((x) => x !== "") ?? [];
  }
}

/** Keeps the newest addresses when the joined list exceeds `IdentitySessionConsts.maxIpAddressesLength`. */
function joinAsString(list: string[]): string | undefined {
  let serialized = list.join(",");
  if (isNullOrWhiteSpace(serialized)) return undefined;
  while (serialized.length > IdentitySessionConsts.maxIpAddressesLength) {
    const lastCommaIndex = serialized.indexOf(",");
    if (lastCommaIndex < 0) return serialized;
    serialized = serialized.slice(lastCommaIndex + 1);
  }
  return serialized;
}
