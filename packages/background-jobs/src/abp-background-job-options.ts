import { AbpException, type Class } from "@abp/core";
import { BackgroundJobArgsHelper } from "./background-job.js";
import { BackgroundJobNameAttribute } from "./background-job-name.js";

/** Port of `BackgroundJobConfiguration`. */
export class BackgroundJobConfiguration {
  readonly argsType: Class;

  constructor(
    readonly jobType: Class,
    readonly jobName: string,
  ) {
    this.argsType = BackgroundJobArgsHelper.getJobArgsType(jobType);
  }
}

/** Port of `AbpBackgroundJobOptions`. */
export class AbpBackgroundJobOptions {
  private readonly jobConfigurationsByArgsType = new Map<Class, BackgroundJobConfiguration>();
  private readonly jobConfigurationsByName = new Map<string, BackgroundJobConfiguration>();

  /** Default: true. */
  isJobExecutionEnabled = true;
  /** The delegate to get the name of a background job from its args type. Default: `BackgroundJobNameAttribute.getName`. */
  getBackgroundJobName: (jobArgsType: Class) => string = BackgroundJobNameAttribute.getName;

  get jobConfigurations(): readonly BackgroundJobConfiguration[] {
    return this.getJobs();
  }

  /** `GetJob(Type argsType)` / `GetJob(string name)`; throws when undefined. */
  getJob(argsTypeOrName: Class | string): BackgroundJobConfiguration {
    if (typeof argsTypeOrName === "string") {
      const byName = this.getJobOrNull(argsTypeOrName);
      if (!byName) throw new AbpException(`Undefined background job for the job name: ${argsTypeOrName}`);
      return byName;
    }
    const byArgsType = this.jobConfigurationsByArgsType.get(argsTypeOrName);
    if (!byArgsType) throw new AbpException(`Undefined background job for the job args type: ${argsTypeOrName.name}`);
    return byArgsType;
  }

  getJobOrNull(name: string): BackgroundJobConfiguration | undefined {
    return this.jobConfigurationsByName.get(name);
  }

  getJobs(): readonly BackgroundJobConfiguration[] {
    return [...this.jobConfigurationsByArgsType.values()];
  }

  addJob(jobTypeOrConfiguration: Class | BackgroundJobConfiguration): void {
    const configuration = jobTypeOrConfiguration instanceof BackgroundJobConfiguration ? jobTypeOrConfiguration : new BackgroundJobConfiguration(jobTypeOrConfiguration, this.getBackgroundJobName(BackgroundJobArgsHelper.getJobArgsType(jobTypeOrConfiguration)));
    this.jobConfigurationsByArgsType.set(configuration.argsType, configuration);
    this.jobConfigurationsByName.set(configuration.jobName, configuration);
  }
}
