import { Dependency, Transient, type Guid } from "@abp/core";
import { BackgroundJobInfo, IBackgroundJobStore, type BackgroundJobNameFilter } from "@abp/background-jobs";
import { objectMapperToken, type IObjectMapper } from "@abp/object-mapping";
import { AbpBackgroundJobsDomainModule } from "./abp-background-jobs-domain-module.js";
import { BackgroundJobRecord } from "./background-job-record.js";
import { IBackgroundJobRepository } from "./background-job-repository.js";

/** Port of `BackgroundJobStore`: replaces `InMemoryBackgroundJobStore` with the repository-backed store. */
@Dependency({ replaceServices: true })
@Transient(IBackgroundJobStore)
export class BackgroundJobStore implements IBackgroundJobStore {
  static readonly inject = [IBackgroundJobRepository, objectMapperToken(AbpBackgroundJobsDomainModule)] as const;

  constructor(
    protected readonly backgroundJobRepository: IBackgroundJobRepository,
    protected readonly objectMapper: IObjectMapper,
  ) {}

  async find(jobId: Guid): Promise<BackgroundJobInfo | undefined> {
    const backgroundJobRecord = await this.backgroundJobRepository.find(jobId);
    if (backgroundJobRecord === undefined) return undefined;
    return this.objectMapper.map(BackgroundJobRecord, BackgroundJobInfo, backgroundJobRecord);
  }

  async insert(jobInfo: BackgroundJobInfo): Promise<void> {
    await this.backgroundJobRepository.insert(this.objectMapper.map(BackgroundJobInfo, BackgroundJobRecord, jobInfo));
  }

  async getWaitingJobs(applicationName: string | undefined, maxResultCount: number, jobNameFilter?: BackgroundJobNameFilter): Promise<BackgroundJobInfo[]> {
    return this.objectMapper.mapList(BackgroundJobRecord, BackgroundJobInfo, await this.backgroundJobRepository.getWaitingList(applicationName, maxResultCount, jobNameFilter));
  }

  async delete(jobId: Guid): Promise<void> {
    await this.backgroundJobRepository.deleteById(jobId);
  }

  deleteCompleted(applicationName: string | undefined, completedBefore: Date, maxResultCount: number, signal?: AbortSignal): Promise<number> {
    return this.backgroundJobRepository.deleteCompleted(applicationName, completedBefore, maxResultCount, signal);
  }

  async update(jobInfo: BackgroundJobInfo): Promise<void> {
    const backgroundJobRecord = await this.backgroundJobRepository.find(jobInfo.id);
    if (backgroundJobRecord === undefined) return;

    this.objectMapper.mapTo(BackgroundJobInfo, BackgroundJobRecord, jobInfo, backgroundJobRecord);
    await this.backgroundJobRepository.update(backgroundJobRecord);
  }
}
