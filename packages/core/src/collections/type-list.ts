import type { Class } from "../dependency-injection/service-token.js";

/** Port of `ITypeList<TBaseType>`: an ordered, de-duplicated list of classes. */
export class TypeList<TBase = unknown> implements Iterable<Class<TBase & object>> {
  private readonly items: Class<TBase & object>[] = [];

  get length(): number {
    return this.items.length;
  }

  add(type: Class<TBase & object>): void {
    if (!this.items.includes(type)) this.items.push(type);
  }

  tryAdd(type: Class<TBase & object>): boolean {
    if (this.items.includes(type)) return false;
    this.items.push(type);
    return true;
  }

  addRange(types: Iterable<Class<TBase & object>>): void {
    for (const t of types) this.add(t);
  }

  remove(type: Class<TBase & object>): boolean {
    const i = this.items.indexOf(type);
    if (i < 0) return false;
    this.items.splice(i, 1);
    return true;
  }

  contains(type: Class<TBase & object>): boolean {
    return this.items.includes(type);
  }

  clear(): void {
    this.items.length = 0;
  }

  toArray(): Class<TBase & object>[] {
    return [...this.items];
  }

  [Symbol.iterator](): Iterator<Class<TBase & object>> {
    return this.items[Symbol.iterator]();
  }
}
