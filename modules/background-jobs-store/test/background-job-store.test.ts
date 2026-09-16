import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AbpModule, DependsOn, Guid, NullLoggerFactory } from "@abp/core";
import { AbpBackgroundJobOptions, BackgroundJobInfo, BackgroundJobNameFilter, BackgroundJobPriority, IBackgroundJobManager, IBackgroundJobStore } from "@abp/background-jobs";
import { createAbpIntegratedTest } from "@abp/test-base";
import { AbpBackgroundJobsDomainModule, BackgroundJobStore, IBackgroundJobRepository } from "../src/domain/index.js";
import { AbpBackgroundJobsMemoryDbModule } from "../src/memory-db/index.js";

class SendEmailArgs {
  to = "";
}

@DependsOn(AbpBackgroundJobsDomainModule, AbpBackgroundJobsMemoryDbModule)
class TestModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpBackgroundJobOptions, (options) => {
      options.isJobExecutionEnabled = false;
    });
  }
}

const test = createAbpIntegratedTest(TestModule, {
  setAbpApplicationCreationOptions: (options) => {
    options.loggerFactory = NullLoggerFactory.instance;
  },
});

beforeAll(() => test.initialize());
afterAll(() => test.dispose());

const past = new Date(Date.now() - 60_000);
const future = new Date(Date.now() + 60 * 60_000);

function job(init: Partial<BackgroundJobInfo>): BackgroundJobInfo {
  return new BackgroundJobInfo({ id: Guid.newGuid(), applicationName: "app", jobName: "Job", jobArgs: "{}", creationTime: past, nextTryTime: past, ...init });
}

describe("BackgroundJobStore on memory-db", () => {
  it("replaces InMemoryBackgroundJobStore", () => {
    expect(test.getRequiredService(IBackgroundJobStore)).toBeInstanceOf(BackgroundJobStore);
  });

  it("inserts, finds, lists waiting jobs in priority order, updates and deletes", async () => {
    const store = test.getRequiredService(IBackgroundJobStore);
    const high = job({ jobName: "HighJob", priority: BackgroundJobPriority.High });
    const normalRetried = job({ jobName: "NormalJob", tryCount: 2 });
    const normalFresh = job({ jobName: "NormalJob", nextTryTime: new Date(past.getTime() - 1000) });
    const notDue = job({ jobName: "LaterJob", nextTryTime: future });
    const otherApp = job({ jobName: "OtherApp", applicationName: "other" });
    for (const info of [high, normalRetried, normalFresh, notDue, otherApp]) await store.insert(info);

    const found = await store.find(high.id);
    expect(found).toBeInstanceOf(BackgroundJobInfo);
    expect(found).toMatchObject({ id: high.id, jobName: "HighJob", priority: BackgroundJobPriority.High, applicationName: "app", isAbandoned: false });
    expect(found?.creationTime).toEqual(past);
    expect(await store.find(Guid.newGuid())).toBeUndefined();

    const waiting = await store.getWaitingJobs("app", 10);
    expect(waiting.map((j) => j.id)).toEqual([high.id, normalFresh.id, normalRetried.id]);
    expect((await store.getWaitingJobs("app", 2)).map((j) => j.id)).toEqual([high.id, normalFresh.id]);
    expect((await store.getWaitingJobs("other", 10)).map((j) => j.id)).toEqual([otherApp.id]);
    expect((await store.getWaitingJobs("app", 10, BackgroundJobNameFilter.include(["NormalJob"]))).map((j) => j.jobName)).toEqual(["NormalJob", "NormalJob"]);
    expect((await store.getWaitingJobs("app", 10, BackgroundJobNameFilter.exclude(["NormalJob"]))).map((j) => j.id)).toEqual([high.id]);

    high.tryCount = 1;
    high.lastTryTime = new Date();
    high.nextTryTime = future;
    await store.update(high);
    expect((await store.find(high.id))?.tryCount).toBe(1);
    expect((await store.getWaitingJobs("app", 10)).map((j) => j.id)).toEqual([normalFresh.id, normalRetried.id]);

    normalRetried.isAbandoned = true;
    await store.update(normalRetried);
    expect((await store.find(normalRetried.id))?.isAbandoned).toBe(true);
    expect((await store.getWaitingJobs("app", 10)).map((j) => j.id)).toEqual([normalFresh.id]);

    await store.delete(normalFresh.id);
    expect(await store.find(normalFresh.id)).toBeUndefined();
    expect(await store.getWaitingJobs("app", 10)).toEqual([]);
    await expect(store.update(job({}))).resolves.toBeUndefined();
  });

  it("keeps completed jobs out of the waiting list and deletes them after their retention", async () => {
    const store = test.getRequiredService(IBackgroundJobStore);
    const oldest = job({ jobName: "Done", applicationName: "cleanup", completionTime: new Date("2026-01-01T00:00:00Z") });
    const older = job({ jobName: "Done", applicationName: "cleanup", completionTime: new Date("2026-01-02T00:00:00Z") });
    const recent = job({ jobName: "Done", applicationName: "cleanup", completionTime: new Date("2026-06-01T00:00:00Z") });
    for (const info of [older, oldest, recent]) await store.insert(info);

    expect(await store.getWaitingJobs("cleanup", 10)).toEqual([]);
    expect(await store.deleteCompleted("cleanup", new Date("2026-03-01T00:00:00Z"), 1)).toBe(1);
    expect(await store.find(oldest.id)).toBeUndefined();
    expect(await store.find(older.id)).toBeDefined();
    expect(await store.deleteCompleted("cleanup", new Date("2026-03-01T00:00:00Z"), 10)).toBe(1);
    expect(await store.deleteCompleted("cleanup", new Date("2026-03-01T00:00:00Z"), 10)).toBe(0);
    expect(await store.find(recent.id)).toBeDefined();
  });

  it("backs the default background job manager", async () => {
    const manager = test.getRequiredService(IBackgroundJobManager);
    const id = await manager.enqueue(SendEmailArgs, Object.assign(new SendEmailArgs(), { to: "a@b.com" }), BackgroundJobPriority.AboveNormal);
    const stored = await test.getRequiredService(IBackgroundJobStore).find(id);
    expect(stored).toMatchObject({ jobName: "SendEmailArgs", priority: BackgroundJobPriority.AboveNormal });
    expect(stored?.jobArgs).toContain("a@b.com");
    expect(await test.withUnitOfWork((p) => p.getRequired(IBackgroundJobRepository).getCount())).toBeGreaterThan(0);
  });
});
