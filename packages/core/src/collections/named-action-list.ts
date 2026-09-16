/** Port of `NamedActionList<T>` / `NamedObjectList<T>`. */
export class NamedAction<T> {
  constructor(
    readonly name: string,
    readonly action: (arg: T) => void | Promise<void>,
  ) {}
}

export class NamedActionList<T> extends Array<NamedAction<T>> {
  addAction(name: string, action: (arg: T) => void | Promise<void>): this {
    this.push(new NamedAction(name, action));
    return this;
  }

  removeByName(name: string): void {
    for (let i = this.length - 1; i >= 0; i--) {
      if (this[i]!.name === name) this.splice(i, 1);
    }
  }
}

export class NamedObject<T> {
  constructor(
    readonly name: string,
    readonly value: T,
  ) {}
}

export class NamedObjectList<T> extends Array<NamedObject<T>> {
  addObject(name: string, value: T): this {
    this.push(new NamedObject(name, value));
    return this;
  }

  getByName(name: string): NamedObject<T> | undefined {
    return this.find((x) => x.name === name);
  }
}
