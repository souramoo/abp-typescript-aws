import { AbpModule, Singleton, createToken } from "@abp/core";

/** Port of `ITestCounter` (Volo.Abp.Testing.Utils). */
export interface ITestCounter {
  add(name: string, count: number): number;
  decrement(name: string): number;
  increment(name: string): number;
  getValue(name: string): number;
  resetCount(name: string): void;
}
export const ITestCounter = createToken<ITestCounter>("ITestCounter");

/** Port of `TestCounter`. */
@Singleton(ITestCounter)
export class TestCounter implements ITestCounter {
  private readonly values = new Map<string, number>();

  increment(name: string): number {
    return this.add(name, 1);
  }

  decrement(name: string): number {
    return this.add(name, -1);
  }

  add(name: string, count: number): number {
    const newValue = (this.values.get(name) ?? 0) + count;
    this.values.set(name, newValue);
    return newValue;
  }

  getValue(name: string): number {
    return this.values.get(name) ?? 0;
  }

  resetCount(name: string): void {
    this.values.set(name, 0);
  }
}

/** Port of `AbpTestBaseModule`: importing it registers the `TestCounter`. */
export class AbpTestBaseModule extends AbpModule {}
