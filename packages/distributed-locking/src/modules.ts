import { AbpModule, DependsOn } from "@abp/core";
import "./distributed-lock-key-normalizer.js";
import "./local-abp-distributed-lock.js";

/** Port of `AbpDistributedLockingAbstractionsModule`: registers the key normalizer and the local lock. */
export class AbpDistributedLockingAbstractionsModule extends AbpModule {}

/**
 * Port of `AbpDistributedLockingModule`. The .NET module also depends on `AbpThreadingModule` (part of `@abp/core`
 * here) and replaces the local lock with a Medallion provider; the DynamoDB provider plays that role in this port.
 */
@DependsOn(AbpDistributedLockingAbstractionsModule)
export class AbpDistributedLockingModule extends AbpModule {}
