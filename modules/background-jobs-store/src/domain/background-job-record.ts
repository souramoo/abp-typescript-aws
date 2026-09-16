import type { Guid } from "@abp/core";
import type { IHasCreationTime } from "@abp/auditing";
import { BackgroundJobPriority } from "@abp/background-jobs";
import { AggregateRoot } from "@abp/ddd-domain";

/** Port of `BackgroundJobRecord`: the persisted form of a `BackgroundJobInfo`. */
export class BackgroundJobRecord extends AggregateRoot<Guid> implements IHasCreationTime {
  /** Application name that scheduled this job. */
  applicationName: string | undefined = undefined;
  /** Name of the job (from `@BackgroundJobName` or the args class name). */
  jobName = "";
  /** Job arguments as serialized string. */
  jobArgs = "";
  /** Try count of this job. A job is re-tried if it fails. */
  tryCount = 0;
  creationTime: Date = new Date(0);
  nextTryTime: Date = new Date(0);
  lastTryTime: Date | undefined = undefined;
  /** True if this job continuously failed and will not be executed again. */
  isAbandoned = false;
  /** Set when a successful job is kept as history; such jobs are excluded from the waiting query. */
  completionTime: Date | undefined = undefined;
  priority: BackgroundJobPriority = BackgroundJobPriority.Normal;

  constructor(id?: Guid) {
    super(id);
  }
}
