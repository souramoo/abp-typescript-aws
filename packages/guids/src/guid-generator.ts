import { createToken, Guid } from "@abp/core";

/** Port of `IGuidGenerator`: used to generate ids. */
export interface IGuidGenerator {
  create(): Guid;
}
export const IGuidGenerator = createToken<IGuidGenerator>("IGuidGenerator");

/** Port of `SimpleGuidGenerator`: random (v4) guids via `Guid.newGuid()`. */
export class SimpleGuidGenerator implements IGuidGenerator {
  static readonly instance = new SimpleGuidGenerator();

  create(): Guid {
    return Guid.newGuid();
  }
}
