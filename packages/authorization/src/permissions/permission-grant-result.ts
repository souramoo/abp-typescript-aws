import { Check } from "@abp/core";

/** Port of `PermissionGrantResult`. */
export enum PermissionGrantResult {
  Undefined = 0,
  Granted = 1,
  Prohibited = 2,
}

/** Port of `MultiplePermissionGrantResult`: `Result` is a `Map` of permission name to grant result. */
export class MultiplePermissionGrantResult {
  readonly result = new Map<string, PermissionGrantResult>();

  constructor(names?: readonly string[], grantResult: PermissionGrantResult = PermissionGrantResult.Undefined) {
    if (names === undefined) return;
    for (const name of Check.notNull(names, "names")) this.result.set(name, grantResult);
  }

  get allGranted(): boolean {
    return [...this.result.values()].every((x) => x === PermissionGrantResult.Granted);
  }

  get allProhibited(): boolean {
    return [...this.result.values()].every((x) => x === PermissionGrantResult.Prohibited);
  }

  isGranted(name: string): boolean {
    return this.result.get(name) === PermissionGrantResult.Granted;
  }
}

/** Port of `PermissionGrantInfo`. */
export class PermissionGrantInfo {
  constructor(
    readonly name: string,
    readonly isGranted: boolean,
    readonly providerName?: string,
    readonly providerKey?: string,
  ) {
    Check.notNull(name, "name");
  }
}
