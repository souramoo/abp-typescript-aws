import { Singleton, createToken, type Guid } from "@abp/core";
import { IClock } from "@abp/timing";
import type { BackgroundJobInfo } from "./background-job-info.js";
import { BackgroundJobNameFilter } from "./background-job-name-filter.js";

/** Port of `IBackgroundJobStore`. */
export interface IBackgroundJobStore {
  find(jobId: Guid): Promise<BackgroundJobInfo | undefined>;
  insert(jobInfo: BackgroundJobInfo): Promise<void>;
  /**
   * Waiting jobs: `applicationName` matches, not abandoned, not completed, `nextTryTime <= now`, name passes
   * `jobNameFilter`; ordered by priority desc, tryCount asc, nextTryTime asc; at most `maxResultCount`.
   */
  getWaitingJobs(applicationName: string | undefined, maxResultCount: number, jobNameFilter?: BackgroundJobNameFilter): Promise<BackgroundJobInfo[]>;
  delete(jobId: Guid): Promise<void>;
  /** Deletes kept successful jobs completed before `completedBefore` (retention cleanup); returns the count. */
  deleteCompleted(applicationName: string | undefined, completedBefore: Date, maxResultCount: number, signal?: AbortSignal): Promise<number>;
  update(jobInfo: BackgroundJobInfo): Promise<void>;
}
export const IBackgroundJobStore = createToken<IBackgroundJobStore>("IBackgroundJobStore");

/** Port of `InMemoryBackgroundJobStore`. */
@Singleton(IBackgroundJobStore)
export class InMemoryBackgroundJobStore implements IBackgroundJobStore {
  static readonly inject = [IClock] as const;
  private readonly jobs = new Map<Guid, BackgroundJobInfo>();

  constructor(protected readonly clock: IClock) {}

  async find(jobId: Guid): Promise<BackgroundJobInfo | undefined> {
    return this.jobs.get(jobId);
  }

  async insert(jobInfo: BackgroundJobInfo): Promise<void> {
    this.jobs.set(jobInfo.id, jobInfo);
  }

  async getWaitingJobs(applicationName: string | undefined, maxResultCount: number, jobNameFilter?: BackgroundJobNameFilter): Promise<BackgroundJobInfo[]> {
    const filter = jobNameFilter ?? BackgroundJobNameFilter.None;
    const now = this.clock.now.getTime();
    return [...this.jobs.values()]
      .filter((t) => t.applicationName === applicationName)
      .filter((t) => !t.isAbandoned && t.completionTime === undefined && t.nextTryTime.getTime() <= now)
      .filter((t) => filter.isMatch(t.jobName))
      .sort((a, b) => b.priority - a.priority || a.tryCount - b.tryCount || a.nextTryTime.getTime() - b.nextTryTime.getTime())
      .slice(0, maxResultCount);
  }

  async delete(jobId: Guid): Promise<void> {
    this.jobs.delete(jobId);
  }

  async deleteCompleted(applicationName: string | undefined, completedBefore: Date, maxResultCount: number): Promise<number> {
    const idsToDelete = [...this.jobs.values()]
      .filter((t) => t.applicationName === applicationName)
      .filter((t) => t.completionTime !== undefined && t.completionTime.getTime() < completedBefore.getTime())
      .sort((a, b) => a.completionTime!.getTime() - b.completionTime!.getTime())
      .slice(0, maxResultCount)
      .map((t) => t.id);
    for (const id of idsToDelete) this.jobs.delete(id);
    return idsToDelete.length;
  }

  /** Like .NET: an abandoned job is removed from the in-memory store; other updates are in place already. */
  async update(jobInfo: BackgroundJobInfo): Promise<void> {
    if (jobInfo.isAbandoned) await this.delete(jobInfo.id);
  }

  get size(): number {
    return this.jobs.size;
  }
}
