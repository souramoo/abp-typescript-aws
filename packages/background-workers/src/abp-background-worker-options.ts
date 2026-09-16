/** Port of `AbpBackgroundWorkerOptions`. */
export class AbpBackgroundWorkerOptions {
  /** Default: true. */
  isEnabled = true;
  /**
   * Starts the workers' timers when the application initializes (the .NET behaviour). Defaults to false in
   * Lambda-style hosting (`AWS_LAMBDA_FUNCTION_NAME` set), where a scheduled invocation calls
   * `IBackgroundWorkerManager.runAllOnce()` instead of running timers.
   */
  startWorkersOnInitialization = process.env["AWS_LAMBDA_FUNCTION_NAME"] === undefined;
}
