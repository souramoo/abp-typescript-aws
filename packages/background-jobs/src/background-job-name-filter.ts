import { ArgumentException, isNullOrWhiteSpace } from "@abp/core";

/** Port of `BackgroundJobNameFilterMode`. */
export enum BackgroundJobNameFilterMode {
  None = 0,
  Include = 1,
  Exclude = 2,
}

/** Port of `BackgroundJobNameFilter`: a worker filters waiting jobs by name (none, include-only or exclude-only). */
export class BackgroundJobNameFilter {
  static readonly None = new BackgroundJobNameFilter(BackgroundJobNameFilterMode.None);
  readonly jobNames: readonly string[];

  constructor(
    readonly mode: BackgroundJobNameFilterMode,
    jobNames?: readonly string[],
  ) {
    if (!Object.values(BackgroundJobNameFilterMode).includes(mode)) throw new ArgumentException(`Invalid background job name filter mode: ${mode}`, "mode");
    const names = [...new Set((jobNames ?? []).filter((x) => !isNullOrWhiteSpace(x)))];
    if (mode === BackgroundJobNameFilterMode.None && names.length > 0) throw new ArgumentException("Job names must be empty when the filter mode is None.", "jobNames");
    if (mode !== BackgroundJobNameFilterMode.None && names.length === 0) throw new ArgumentException("Job names cannot be empty when the filter mode is Include or Exclude.", "jobNames");
    this.jobNames = names;
  }

  static include(jobNames: readonly string[]): BackgroundJobNameFilter {
    return new BackgroundJobNameFilter(BackgroundJobNameFilterMode.Include, jobNames);
  }

  static exclude(jobNames: readonly string[]): BackgroundJobNameFilter {
    return new BackgroundJobNameFilter(BackgroundJobNameFilterMode.Exclude, jobNames);
  }

  isMatch(jobName: string): boolean {
    switch (this.mode) {
      case BackgroundJobNameFilterMode.Include:
        return this.jobNames.includes(jobName);
      case BackgroundJobNameFilterMode.Exclude:
        return !this.jobNames.includes(jobName);
      case BackgroundJobNameFilterMode.None:
        return true;
      default: {
        const _exhaustive: never = this.mode;
        return _exhaustive;
      }
    }
  }
}
