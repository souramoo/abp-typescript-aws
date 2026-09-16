import { Check, type Guid } from "@abp/core";
import { Entity, type IAggregateRoot } from "@abp/ddd-domain";

/** Port of `FeatureValue`: one stored value of a feature for a provider (`T`, `E`, ...) and its key. */
export class FeatureValue extends Entity<Guid> implements IAggregateRoot<Guid> {
  name: string;
  value: string;
  providerName: string;
  providerKey: string | undefined;

  constructor(id: Guid, name: string, value: string, providerName: string, providerKey?: string) {
    super(id);
    this.name = Check.notNullOrWhiteSpace(name, "name");
    this.value = Check.notNullOrWhiteSpace(value, "value");
    this.providerName = Check.notNullOrWhiteSpace(providerName, "providerName");
    this.providerKey = providerKey;
  }
}
Object.defineProperty(FeatureValue.prototype, "__aggregateRoot", { value: true });
