import { Check, type Guid } from "@abp/core";
import { Entity, type IAggregateRoot } from "@abp/ddd-domain";

/** Port of `Setting`: one stored value of a setting for a provider (`G`, `T`, `U`, ...) and its key. */
export class Setting extends Entity<Guid> implements IAggregateRoot<Guid> {
  name: string;
  value: string;
  providerName: string | undefined;
  providerKey: string | undefined;

  constructor(id: Guid, name: string, value: string, providerName?: string, providerKey?: string) {
    super(id);
    this.name = Check.notNull(name, "name");
    this.value = Check.notNull(value, "value");
    this.providerName = providerName;
    this.providerKey = providerKey;
  }

  override toString(): string {
    return `${super.toString()}, Name = ${this.name}, Value = ${this.value}, ProviderName = ${this.providerName}, ProviderKey = ${this.providerKey}`;
  }
}
Object.defineProperty(Setting.prototype, "__aggregateRoot", { value: true });
