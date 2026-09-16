import { AbpException, LogLevel, type IHasErrorCode, type IHasLogLevel } from "@abp/core";

/** Port of `AbpAuthorizationException`: thrown on an unauthorized request. */
export class AbpAuthorizationException extends AbpException implements IHasLogLevel, IHasErrorCode {
  logLevel: LogLevel = LogLevel.Warning;
  readonly code: string | undefined;
  readonly data: Record<string, unknown> = {};

  constructor(message?: string, code?: string, cause?: unknown) {
    super(message ?? "Authorization failed!", { cause });
    this.code = code;
  }

  withData(name: string, value: unknown): this {
    this.data[name] = value;
    return this;
  }
}

/** Port of `AbpRoleConsts`. */
export const AbpRoleConsts = {
  adminRoleName: "admin",
} as const;
