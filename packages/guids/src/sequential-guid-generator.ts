import { randomFillSync } from "node:crypto";
import { type Guid, type IOptions, IGuidGeneratorLite, Transient, optionsToken } from "@abp/core";
import { IGuidGenerator } from "./guid-generator.js";

/**
 * Port of `SequentialGuidType`. Kept for API compatibility: the .NET generator lays the timestamp out
 * differently per database, whereas this port always emits RFC 9562 UUID v7 (timestamp first), which sorts
 * correctly as a string, as binary and in DynamoDB.
 */
export enum SequentialGuidType {
  SequentialAsString = "SequentialAsString",
  SequentialAsBinary = "SequentialAsBinary",
  SequentialAtEnd = "SequentialAtEnd",
}

export class AbpSequentialGuidGeneratorOptions {
  /** Default: undefined; see {@link getDefaultSequentialGuidType}. */
  defaultSequentialGuidType: SequentialGuidType | undefined = undefined;

  getDefaultSequentialGuidType(): SequentialGuidType {
    return this.defaultSequentialGuidType ?? SequentialGuidType.SequentialAtEnd;
  }
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
const SEQUENCE_MAX = 0x0fff;

/**
 * Port of `SequentialGuidGenerator` producing RFC 9562 UUID v7: 48-bit unix-millisecond timestamp, 12-bit
 * monotonic sequence (`rand_a`) and 62 random bits. Ids created within the same millisecond stay ordered
 * across all instances of this transient service because the sequence state is process-wide.
 */
@Transient(IGuidGenerator, IGuidGeneratorLite)
export class SequentialGuidGenerator implements IGuidGenerator {
  static readonly inject = [optionsToken(AbpSequentialGuidGeneratorOptions)] as const;
  private static lastTimestamp = 0;
  private static sequence = 0;

  readonly options: AbpSequentialGuidGeneratorOptions;

  constructor(options: IOptions<AbpSequentialGuidGeneratorOptions>) {
    this.options = options.value;
  }

  create(): Guid {
    const { timestamp, sequence } = SequentialGuidGenerator.nextTick(Date.now());
    const bytes = new Uint8Array(16);
    randomFillSync(bytes, 8, 8);

    bytes[0] = Math.floor(timestamp / 2 ** 40) & 0xff;
    bytes[1] = Math.floor(timestamp / 2 ** 32) & 0xff;
    bytes[2] = (timestamp >>> 24) & 0xff;
    bytes[3] = (timestamp >>> 16) & 0xff;
    bytes[4] = (timestamp >>> 8) & 0xff;
    bytes[5] = timestamp & 0xff;
    bytes[6] = 0x70 | ((sequence >>> 8) & 0x0f);
    bytes[7] = sequence & 0xff;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;

    return format(bytes);
  }

  private static nextTick(now: number): { timestamp: number; sequence: number } {
    if (now > this.lastTimestamp) {
      this.lastTimestamp = now;
      this.sequence = 0;
    } else if (this.sequence < SEQUENCE_MAX) {
      this.sequence++;
    } else {
      this.lastTimestamp++;
      this.sequence = 0;
    }
    return { timestamp: this.lastTimestamp, sequence: this.sequence };
  }
}

function format(bytes: Uint8Array): Guid {
  let out = "";
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += "-";
    out += HEX[bytes[i]!];
  }
  return out;
}
