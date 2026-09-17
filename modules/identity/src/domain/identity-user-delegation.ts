import type { Guid } from "@abp/core";
import { BasicAggregateRoot } from "@abp/ddd-domain";
import type { IMultiTenant } from "@abp/multi-tenancy-abstractions";

/** Port of `IdentityUserDelegation`: `sourceUserId` lets `targetUserId` act on its behalf between `startTime` and `endTime`. */
export class IdentityUserDelegation extends BasicAggregateRoot<Guid> implements IMultiTenant {
  tenantId: Guid | undefined = undefined;
  sourceUserId!: Guid;
  targetUserId!: Guid;
  startTime!: Date;
  endTime!: Date;

  constructor(id?: Guid, sourceUserId?: Guid, targetUserId?: Guid, startTime?: Date, endTime?: Date, tenantId?: Guid) {
    super(id);
    if (id === undefined) return;
    this.tenantId = tenantId;
    this.sourceUserId = sourceUserId!;
    this.targetUserId = targetUserId!;
    this.startTime = startTime!;
    this.endTime = endTime!;
  }

  isActiveAt(now: Date): boolean {
    return this.startTime.getTime() <= now.getTime() && this.endTime.getTime() >= now.getTime();
  }
}
