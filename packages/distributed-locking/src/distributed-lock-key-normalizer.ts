import { Transient, createToken, optionsToken, type IOptions } from "@abp/core";
import { AbpDistributedLockOptions } from "./abp-distributed-lock-options.js";

/** Port of `IDistributedLockKeyNormalizer`. */
export interface IDistributedLockKeyNormalizer {
  normalizeKey(name: string): string;
}
export const IDistributedLockKeyNormalizer = createToken<IDistributedLockKeyNormalizer>("IDistributedLockKeyNormalizer");

/** Port of `DistributedLockKeyNormalizer`: prepends `AbpDistributedLockOptions.keyPrefix`. */
@Transient(IDistributedLockKeyNormalizer)
export class DistributedLockKeyNormalizer implements IDistributedLockKeyNormalizer {
  static readonly inject = [optionsToken(AbpDistributedLockOptions)] as const;
  protected readonly options: AbpDistributedLockOptions;

  constructor(options: IOptions<AbpDistributedLockOptions>) {
    this.options = options.value;
  }

  normalizeKey(name: string): string {
    return `${this.options.keyPrefix}${name}`;
  }
}
