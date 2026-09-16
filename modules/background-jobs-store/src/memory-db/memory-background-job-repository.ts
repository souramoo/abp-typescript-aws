import type { Guid } from "@abp/core";
import type { BackgroundJobNameFilter } from "@abp/background-jobs";
import { MemoryDbRepository, memoryDatabaseProviderToken, type IMemoryDatabaseProvider } from "@abp/memory-db";
import { IClock } from "@abp/timing";
import { BackgroundJobRecord, isWaitingJob, orderWaitingJobs, type IBackgroundJobRepository } from "../domain/index.js";
import { BackgroundJobsMemoryDbContext } from "./background-jobs-memory-db-context.js";

/** `IBackgroundJobRepository` over `@abp/memory-db`. */
export class MemoryBackgroundJobRepository extends MemoryDbRepository<BackgroundJobsMemoryDbContext, BackgroundJobRecord, Guid> implements IBackgroundJobRepository {
  static readonly inject = [memoryDatabaseProviderToken(BackgroundJobsMemoryDbContext), IClock] as const;

  constructor(
    databaseProvider: IMemoryDatabaseProvider<BackgroundJobsMemoryDbContext>,
    protected readonly clock: IClock,
  ) {
    super(databaseProvider, BackgroundJobRecord);
  }

  async getWaitingList(applicationName: string | undefined, maxResultCount: number, jobNameFilter?: BackgroundJobNameFilter, signal?: AbortSignal): Promise<BackgroundJobRecord[]> {
    const now = this.clock.now;
    const due = await (await this.getQueryable()).where((record) => isWaitingJob(record, applicationName, now)).toList(signal);
    return orderWaitingJobs(due, maxResultCount, jobNameFilter);
  }

  async deleteCompleted(applicationName: string | undefined, completedBefore: Date, maxResultCount: number, signal?: AbortSignal): Promise<number> {
    const records = await (await this.getQueryable())
      .where((record) => record.applicationName === applicationName && record.completionTime !== undefined && record.completionTime.getTime() < completedBefore.getTime())
      .orderBy("completionTime")
      .take(maxResultCount)
      .toList(signal);
    if (records.length === 0) return 0;
    await this.deleteMany(records, true, signal);
    return records.length;
  }
}
