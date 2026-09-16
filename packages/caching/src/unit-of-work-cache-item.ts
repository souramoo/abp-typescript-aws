/** Port of `UnitOfWorkCacheItem<TValue>`: a pending cache change held until the unit of work completes. */
export class UnitOfWorkCacheItem<TValue extends object> {
  isRemoved: boolean;
  value: TValue | undefined;

  constructor(value?: TValue, isRemoved = false) {
    this.value = value;
    this.isRemoved = isRemoved;
  }

  setValue(value: TValue): this {
    this.value = value;
    this.isRemoved = false;
    return this;
  }

  removeValue(): this {
    this.value = undefined;
    this.isRemoved = true;
    return this;
  }
}

/** Port of `UnitOfWorkCacheItemExtensions.GetUnRemovedValueOrNull`. */
export function getUnRemovedValueOrNull<TValue extends object>(item: UnitOfWorkCacheItem<TValue> | undefined): TValue | undefined {
  return item !== undefined && !item.isRemoved ? item.value : undefined;
}
