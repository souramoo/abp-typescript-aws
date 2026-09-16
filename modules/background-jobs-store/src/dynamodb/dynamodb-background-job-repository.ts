import type { Guid } from "@abp/core";
import type { BackgroundJobNameFilter } from "@abp/background-jobs";
import { DynamoDbRepository, dynamoDbContextProviderToken, type IDynamoDbContextProvider } from "@abp/dynamodb";
import { IClock } from "@abp/timing";
import { BackgroundJobRecord, orderWaitingJobs, type IBackgroundJobRepository } from "../domain/index.js";
import { BackgroundJobRecordIndexKeys, BackgroundJobsDbContext } from "./background-jobs-db-context.js";

/**
 * Port of `MongoBackgroundJobRepository`. The due jobs come from one `gsi2` query (`waiting#<app>`,
 * `nextTryTime <= now`); the name filter and the priority ordering are applied to that result.
 */
export class DynamoDbBackgroundJobRepository extends DynamoDbRepository<BackgroundJobsDbContext, BackgroundJobRecord, Guid> implements IBackgroundJobRepository {
  static readonly inject = [dynamoDbContextProviderToken(BackgroundJobsDbContext), IClock] as const;

  constructor(
    dbContextProvider: IDynamoDbContextProvider<BackgroundJobsDbContext>,
    protected readonly clock: IClock,
  ) {
    super(dbContextProvider, BackgroundJobRecord);
  }

  async getWaitingList(applicationName: string | undefined, maxResultCount: number, jobNameFilter?: BackgroundJobNameFilter, signal?: AbortSignal): Promise<BackgroundJobRecord[]> {
    const due = await (await this.getDynamoDbQueryable(signal)).usingIndex("gsi2", BackgroundJobRecordIndexKeys.waiting(applicationName), { lte: this.clock.now.toISOString() }).toList(signal);
    return orderWaitingJobs(due, maxResultCount, jobNameFilter);
  }

  async deleteCompleted(applicationName: string | undefined, completedBefore: Date, maxResultCount: number, signal?: AbortSignal): Promise<number> {
    const records = await (await this.getDynamoDbQueryable(signal)).usingIndex("gsi3", BackgroundJobRecordIndexKeys.completed(applicationName), { lt: completedBefore.toISOString() }).take(maxResultCount).toList(signal);
    if (records.length === 0) return 0;
    await this.deleteMany(records, true, signal);
    return records.length;
  }
}
