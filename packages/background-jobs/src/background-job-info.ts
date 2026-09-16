import type { Guid } from "@abp/core";
import { BackgroundJobPriority } from "./background-job-priority.js";

/** Port of `BackgroundJobInfo`: the persisted form of a job. */
export class BackgroundJobInfo {
  id: Guid = "";
  applicationName: string | undefined;
  jobName = "";
  /** Job arguments serialized to string. */
  jobArgs = "";
  /** A job is re-tried if it fails. */
  tryCount = 0;
  creationTime: Date = new Date(0);
  nextTryTime: Date = new Date(0);
  lastTryTime: Date | undefined;
  /** True if this job continuously failed and will not be executed again. */
  isAbandoned = false;
  /** Set when a successful job is kept as history (`AbpBackgroundJobWorkerOptions.storeSuccessfulJobs`). */
  completionTime: Date | undefined;
  priority: BackgroundJobPriority = BackgroundJobPriority.Normal;

  constructor(init: Partial<BackgroundJobInfo> = {}) {
    Object.assign(this, init);
  }
}
