import { createToken, type Guid } from "@abp/core";
import { BackgroundJobNameFilter } from "@abp/background-jobs";
import type { IRepository } from "@abp/ddd-domain";
import type { BackgroundJobRecord } from "./background-job-record.js";

/**
 * Port of `IBackgroundJobRepository` (`IBasicRepository<BackgroundJobRecord, Guid>` in .NET). The
 * `DeleteAsync(applicationName, completedBefore, maxResultCount)` overload is `deleteCompleted`, as in `IBackgroundJobStore`.
 */
export interface IBackgroundJobRepository extends IRepository<BackgroundJobRecord, Guid> {
  /** Waiting jobs of the application, ordered by priority desc, tryCount asc, nextTryTime asc. */
  getWaitingList(applicationName: string | undefined, maxResultCount: number, jobNameFilter?: BackgroundJobNameFilter, signal?: AbortSignal): Promise<BackgroundJobRecord[]>;
  /** Deletes kept successful jobs completed before `completedBefore` (oldest first); returns the deleted count. */
  deleteCompleted(applicationName: string | undefined, completedBefore: Date, maxResultCount: number, signal?: AbortSignal): Promise<number>;
}
export const IBackgroundJobRepository = createToken<IBackgroundJobRepository>("IBackgroundJobRepository");

/** The `Where` clauses of `GetWaitingListQuery` (without the name filter). */
export function isWaitingJob(record: BackgroundJobRecord, applicationName: string | undefined, now: Date): boolean {
  return record.applicationName === applicationName && !record.isAbandoned && record.completionTime === undefined && record.nextTryTime.getTime() <= now.getTime();
}

/** The name filter, ordering (`priority desc, tryCount asc, nextTryTime asc`) and `Take` of `GetWaitingListQuery`. */
export function orderWaitingJobs(records: readonly BackgroundJobRecord[], maxResultCount: number, jobNameFilter?: BackgroundJobNameFilter): BackgroundJobRecord[] {
  const filter = jobNameFilter ?? BackgroundJobNameFilter.None;
  return records
    .filter((record) => filter.isMatch(record.jobName))
    .sort((a, b) => b.priority - a.priority || a.tryCount - b.tryCount || a.nextTryTime.getTime() - b.nextTryTime.getTime())
    .slice(0, maxResultCount);
}
