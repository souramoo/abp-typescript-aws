/** Port of `BackgroundJobPriority`. */
export enum BackgroundJobPriority {
  Low = 5,
  BelowNormal = 10,
  Normal = 15,
  AboveNormal = 20,
  High = 25,
}

/** Port of `JobExecutionResult`. */
export enum JobExecutionResult {
  Success = "Success",
  Failed = "Failed",
}
