/**
 * Port of `ValueObject` (https://docs.microsoft.com/en-us/dotnet/standard/microservices-architecture/microservice-ddd-cqrs-patterns/implement-value-objects).
 * `valueEquals` compares the atomic values pairwise; nested value objects compare structurally, dates by instant.
 */
export abstract class ValueObject {
  protected abstract getAtomicValues(): Iterable<unknown>;

  valueEquals(obj: unknown): boolean {
    if (obj === null || obj === undefined || typeof obj !== "object" || obj.constructor !== this.constructor) return false;
    const other = obj as ValueObject;

    const thisValues = this.getAtomicValues()[Symbol.iterator]();
    const otherValues = other.getAtomicValues()[Symbol.iterator]();

    let thisNext = thisValues.next();
    let otherNext = otherValues.next();
    while (!thisNext.done && !otherNext.done) {
      const a = thisNext.value;
      const b = otherNext.value;
      if ((a === null || a === undefined) !== (b === null || b === undefined)) return false;
      if (a instanceof ValueObject && b instanceof ValueObject) {
        if (!a.valueEquals(b)) return false;
      } else if (a !== null && a !== undefined && !atomicEquals(a, b)) {
        return false;
      }

      thisNext = thisValues.next();
      otherNext = otherValues.next();
      if (Boolean(thisNext.done) !== Boolean(otherNext.done)) return false;
    }

    return Boolean(thisNext.done) && Boolean(otherNext.done);
  }
}

function atomicEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);
  return false;
}
