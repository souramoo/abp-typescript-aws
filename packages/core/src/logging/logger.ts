import { createToken } from "../dependency-injection/service-token.js";

export enum LogLevel {
  Trace = 0,
  Debug = 1,
  Information = 2,
  Warning = 3,
  Error = 4,
  Critical = 5,
  None = 6,
}

export interface ILogger {
  readonly category: string;
  isEnabled(level: LogLevel): boolean;
  log(level: LogLevel, message: string, data?: Record<string, unknown>, error?: unknown): void;
  trace(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>, error?: unknown): void;
  error(message: string, error?: unknown, data?: Record<string, unknown>): void;
  critical(message: string, error?: unknown, data?: Record<string, unknown>): void;
  /** `ILogger.LogException` port: logs with the exception's own level (`IHasLogLevel`) or Error. */
  logException(error: unknown, level?: LogLevel): void;
}

export interface ILoggerFactory {
  createLogger(category: string): ILogger;
}

export const ILoggerFactory = createToken<ILoggerFactory>("ILoggerFactory");
export const ILogger = createToken<ILogger>("ILogger");

/** Port of `IHasLogLevel`. */
export interface IHasLogLevel {
  logLevel: LogLevel;
}
export function hasLogLevel(value: unknown): value is IHasLogLevel {
  return typeof value === "object" && value !== null && "logLevel" in value && typeof (value as IHasLogLevel).logLevel === "number";
}
/** Port of `IExceptionWithSelfLogging`. */
export interface IExceptionWithSelfLogging {
  log(logger: ILogger): void;
}
export function isExceptionWithSelfLogging(value: unknown): value is IExceptionWithSelfLogging {
  return typeof value === "object" && value !== null && typeof (value as IExceptionWithSelfLogging).log === "function";
}

export abstract class LoggerBase implements ILogger {
  constructor(
    readonly category: string,
    protected readonly minimumLevel: LogLevel,
  ) {}
  isEnabled(level: LogLevel): boolean {
    return level >= this.minimumLevel && level !== LogLevel.None;
  }
  abstract write(level: LogLevel, message: string, data: Record<string, unknown> | undefined, error: unknown): void;
  log(level: LogLevel, message: string, data?: Record<string, unknown>, error?: unknown): void {
    if (this.isEnabled(level)) this.write(level, message, data, error);
  }
  trace(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.Trace, message, data);
  }
  debug(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.Debug, message, data);
  }
  info(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.Information, message, data);
  }
  warn(message: string, data?: Record<string, unknown>, error?: unknown): void {
    this.log(LogLevel.Warning, message, data, error);
  }
  error(message: string, error?: unknown, data?: Record<string, unknown>): void {
    this.log(LogLevel.Error, message, data, error);
  }
  critical(message: string, error?: unknown, data?: Record<string, unknown>): void {
    this.log(LogLevel.Critical, message, data, error);
  }
  logException(error: unknown, level?: LogLevel): void {
    const effective = level ?? (hasLogLevel(error) ? error.logLevel : LogLevel.Error);
    const message = error instanceof Error ? error.message : String(error);
    this.log(effective, message, undefined, error);
    if (isExceptionWithSelfLogging(error)) error.log(this);
  }
}

export interface ConsoleLoggerOptions {
  minimumLevel?: LogLevel;
  /** `json` is the right choice on Lambda (CloudWatch structured logs); `pretty` for local dev. */
  format?: "json" | "pretty";
}

const levelNames: Record<LogLevel, string> = {
  [LogLevel.Trace]: "TRACE",
  [LogLevel.Debug]: "DEBUG",
  [LogLevel.Information]: "INFO",
  [LogLevel.Warning]: "WARN",
  [LogLevel.Error]: "ERROR",
  [LogLevel.Critical]: "CRITICAL",
  [LogLevel.None]: "NONE",
};

export function serializeError(error: unknown): Record<string, unknown> | undefined {
  if (error === undefined || error === null) return undefined;
  if (error instanceof Error) {
    const { name, message, stack, cause } = error;
    const extra: Record<string, unknown> = {};
    for (const key of ["code", "details", "logLevel", "httpStatusCode"]) {
      const v = (error as unknown as Record<string, unknown>)[key];
      if (v !== undefined) extra[key] = v;
    }
    return { name, message, stack, ...extra, cause: cause === undefined ? undefined : serializeError(cause) };
  }
  return { message: String(error) };
}

export class ConsoleLogger extends LoggerBase {
  constructor(
    category: string,
    private readonly options: Required<ConsoleLoggerOptions>,
  ) {
    super(category, options.minimumLevel);
  }
  write(level: LogLevel, message: string, data: Record<string, unknown> | undefined, error: unknown): void {
    const sink = level >= LogLevel.Error ? console.error : level === LogLevel.Warning ? console.warn : console.log;
    if (this.options.format === "json") {
      sink(JSON.stringify({ level: levelNames[level], category: this.category, message, ...data, error: serializeError(error), timestamp: new Date().toISOString() }));
      return;
    }
    const suffix = data && Object.keys(data).length > 0 ? " " + JSON.stringify(data) : "";
    sink(`[${levelNames[level]}] ${this.category}: ${message}${suffix}`);
    if (error !== undefined) sink(error);
  }
}

export class ConsoleLoggerFactory implements ILoggerFactory {
  private readonly options: Required<ConsoleLoggerOptions>;
  constructor(options: ConsoleLoggerOptions = {}) {
    this.options = {
      minimumLevel: options.minimumLevel ?? parseLevel(process.env["ABP_LOG_LEVEL"]) ?? LogLevel.Information,
      format: options.format ?? (process.env["ABP_LOG_FORMAT"] === "pretty" ? "pretty" : process.env["AWS_LAMBDA_FUNCTION_NAME"] || process.env["ABP_LOG_FORMAT"] === "json" ? "json" : "pretty"),
    };
  }
  createLogger(category: string): ILogger {
    return new ConsoleLogger(category, this.options);
  }
}

export class NullLogger extends LoggerBase {
  static readonly instance = new NullLogger();
  constructor() {
    super("Null", LogLevel.None);
  }
  write(): void {}
}

export class NullLoggerFactory implements ILoggerFactory {
  static readonly instance = new NullLoggerFactory();
  createLogger(): ILogger {
    return NullLogger.instance;
  }
}

function parseLevel(value: string | undefined): LogLevel | undefined {
  if (!value) return undefined;
  const found = (Object.entries(levelNames) as [string, string][]).find(([, n]) => n === value.toUpperCase());
  return found ? (Number(found[0]) as LogLevel) : undefined;
}
