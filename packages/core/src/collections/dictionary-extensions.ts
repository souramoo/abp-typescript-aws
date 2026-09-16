/** Small ports of ABP's collection extension methods. */
export function getOrAdd<K, V>(map: Map<K, V>, key: K, factory: () => V): V {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const created = factory();
  map.set(key, created);
  return created;
}

export function addIfNotContains<T>(array: T[], ...items: T[]): void {
  for (const item of items) if (!array.includes(item)) array.push(item);
}

export function removeAll<T>(array: T[], predicate: (item: T) => boolean): T[] {
  const removed: T[] = [];
  for (let i = array.length - 1; i >= 0; i--) {
    if (predicate(array[i]!)) removed.unshift(...array.splice(i, 1));
  }
  return removed;
}

export function isNullOrEmpty<T>(value: readonly T[] | null | undefined): value is null | undefined | [] {
  return value == null || value.length === 0;
}

export function distinct<T>(items: Iterable<T>): T[] {
  return [...new Set(items)];
}
