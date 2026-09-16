import { describe, expect, it } from "vitest";
import { Guid } from "@abp/core";
import { AggregateRoot, BasicAggregateRoot, DisableIdGeneration, Entity, EntityBase, EntityCreatedEventData, EntityChangedEventData, EntityEventData, EntityHelper, EntityNotFoundException, EntityUpdatedEventData, EntityCreatedEto, EntityEto, FullAuditedAggregateRoot, ValueObject, encodeCompositeKey, isCreationAuditedEntityType } from "../src/index.js";
import { EventNameAttribute } from "@abp/event-bus";

class Book extends Entity<string> {
  title = "";
  constructor(id?: string, title = "") {
    super(id);
    this.title = title;
  }
}
class SpecialBook extends Book {}

class TenantBook extends Entity<string> {
  tenantId: string | undefined = undefined;
  constructor(id?: string, tenantId?: string) {
    super(id);
    this.tenantId = tenantId;
  }
}

class OrderLine extends EntityBase {
  constructor(
    readonly orderId: string,
    readonly lineNo: number,
  ) {
    super();
  }
  getKeys(): readonly unknown[] {
    return [this.orderId, this.lineNo];
  }
}

class Counter extends Entity<number> {
  override id = 0;
}

class OrderPlaced {
  constructor(readonly orderId: string) {}
}
class Order extends BasicAggregateRoot<string> {
  place(): void {
    this.addLocalEvent(new OrderPlaced(this.id));
    this.addDistributedEvent({ orderId: this.id });
  }
}

class Product extends AggregateRoot<string> {
  name = "";
}

class Address extends ValueObject {
  constructor(
    readonly street: string,
    readonly city: string,
    readonly since?: Date,
  ) {
    super();
  }
  protected getAtomicValues(): Iterable<unknown> {
    return [this.street, this.city, this.since];
  }
}
class Contact extends ValueObject {
  constructor(
    readonly name: string,
    readonly address: Address,
  ) {
    super();
  }
  protected getAtomicValues(): Iterable<unknown> {
    return [this.name, this.address];
  }
}

@DisableIdGeneration()
class ManualIdEntity extends Entity<string> {}

class Audited extends FullAuditedAggregateRoot<string> {}

const id1 = "0192b7b4-4c8f-7a3e-9a2c-2f3f0a5f1a10";
const id2 = "0192b7b4-4c8f-7a3e-9a2c-2f3f0a5f1a11";

describe("Entity", () => {
  it("exposes keys, object key and a readable string", () => {
    const book = new Book(id1, "DDD");
    expect(book.getKeys()).toEqual([id1]);
    expect(book.getObjectKey()).toBe(id1);
    expect(book.toString()).toBe(`[ENTITY: Book] Id = ${id1}`);
    expect(new Book().getObjectKey()).toBeUndefined();

    const line = new OrderLine("o1", 2);
    expect(line.getObjectKey()).toBe(encodeCompositeKey(["o1", 2]));
    expect(line.toString()).toBe("[ENTITY: OrderLine] Keys = o1, 2");
  });

  it("compares entities by type and keys, never by reference alone", () => {
    expect(new Book(id1).entityEquals(new Book(id1))).toBe(true);
    expect(new Book(id1.toUpperCase()).entityEquals(new Book(id1))).toBe(true);
    expect(new Book(id1).entityEquals(new Book(id2))).toBe(false);
    expect(new Book(id1).entityEquals(new SpecialBook(id1))).toBe(true);
    expect(new Book(id1).entityEquals(new TenantBook(id1))).toBe(false);
    expect(new Book().entityEquals(new Book())).toBe(false);
    const same = new Book();
    expect(same.entityEquals(same)).toBe(true);
    expect(new Book(id1).entityEquals(undefined)).toBe(false);
    expect(new OrderLine("o1", 1).entityEquals(new OrderLine("o1", 1))).toBe(true);
    expect(new OrderLine("o1", 1).entityEquals(new OrderLine("o1", 2))).toBe(false);
  });

  it("treats the same id in different tenants as different entities", () => {
    expect(new TenantBook(id1, "t1").entityEquals(new TenantBook(id1, "t1"))).toBe(true);
    expect(new TenantBook(id1, "t1").entityEquals(new TenantBook(id1, "t2"))).toBe(false);
    expect(new TenantBook(id1, "t1").entityEquals(new TenantBook(id1))).toBe(false);
    expect(new TenantBook(id1).entityEquals(new TenantBook(id1))).toBe(true);
  });

  it("detects default ids for strings, guids and numbers", () => {
    expect(EntityHelper.hasDefaultId(new Book())).toBe(true);
    expect(EntityHelper.hasDefaultId(new Book(""))).toBe(true);
    expect(EntityHelper.hasDefaultId(new Book(Guid.empty))).toBe(true);
    expect(EntityHelper.hasDefaultId(new Book(id1))).toBe(false);
    expect(EntityHelper.hasDefaultId(new Counter())).toBe(true);
    const counter = new Counter();
    counter.id = 3;
    expect(EntityHelper.hasDefaultId(counter)).toBe(false);
  });

  it("sets ids through EntityHelper unless generation is disabled", () => {
    const book = new Book();
    EntityHelper.trySetId(book, () => id1, true);
    expect(book.id).toBe(id1);

    const manual = new ManualIdEntity();
    EntityHelper.trySetId(manual, () => id1, true);
    expect(manual.id).toBeUndefined();
    EntityHelper.trySetId(manual, () => id1);
    expect(manual.id).toBe(id1);
  });

  it("classifies entity, aggregate root and value object types", () => {
    expect(EntityHelper.isEntity(Book)).toBe(true);
    expect(EntityHelper.isEntity(Address)).toBe(false);
    expect(EntityHelper.isEntityWithId(Book)).toBe(true);
    expect(EntityHelper.isEntityWithId(OrderLine)).toBe(false);
    expect(EntityHelper.isValueObject(Address)).toBe(true);
    expect(EntityHelper.isValueObject(new Contact("x", new Address("a", "b")))).toBe(true);
    expect(EntityHelper.isValueObject(new Book())).toBe(false);
    expect(() => EntityHelper.checkEntity(Address)).toThrow(/not an entity/);
    expect(EntityHelper.createEqualityExpressionForId<Book, string>(id1)(new Book(id1))).toBe(true);
    expect(isCreationAuditedEntityType(Audited)).toBe(true);
    expect(isCreationAuditedEntityType(Book)).toBe(false);
  });
});

describe("Aggregate roots", () => {
  it("collects ordered local and distributed domain events outside the instance", () => {
    const order = new Order(id1);
    order.place();
    order.place();
    const local = order.getLocalEvents();
    const distributed = order.getDistributedEvents();
    expect(local).toHaveLength(2);
    expect(local[0]!.eventData).toBeInstanceOf(OrderPlaced);
    expect(local[1]!.eventOrder).toBeGreaterThan(local[0]!.eventOrder);
    expect(distributed).toHaveLength(2);
    expect(Object.keys(order)).toEqual(["id"]);
    expect(JSON.parse(JSON.stringify(order))).toEqual({ id: id1 });

    order.clearLocalEvents();
    expect(order.getLocalEvents()).toEqual([]);
    expect(order.getDistributedEvents()).toHaveLength(2);
    order.clearDistributedEvents();
    expect(order.getDistributedEvents()).toEqual([]);
  });

  it("gives full aggregate roots a concurrency stamp and extra properties", () => {
    const product = new Product(id1);
    expect(product.concurrencyStamp).toMatch(/^[0-9a-f]{32}$/);
    expect(new Product(id2).concurrencyStamp).not.toBe(product.concurrencyStamp);
    product.extraProperties.set("Color", "red");
    expect(JSON.parse(JSON.stringify(product))).toMatchObject({ id: id1, extraProperties: { Color: "red" } });

    const audited = new Audited(id1);
    expect(audited).toMatchObject({ isDeleted: false, creatorId: undefined, deletionTime: undefined, lastModifierId: undefined });
    expect("creationTime" in audited).toBe(true);
  });
});

describe("ValueObject", () => {
  it("compares by atomic values, recursively", () => {
    const since = new Date("2020-01-01");
    expect(new Address("a", "b", since).valueEquals(new Address("a", "b", new Date("2020-01-01")))).toBe(true);
    expect(new Address("a", "b").valueEquals(new Address("a", "c"))).toBe(false);
    expect(new Address("a", "b").valueEquals(new Address("a", "b", since))).toBe(false);
    expect(new Contact("n", new Address("a", "b")).valueEquals(new Contact("n", new Address("a", "b")))).toBe(true);
    expect(new Contact("n", new Address("a", "b")).valueEquals(new Contact("n", new Address("a", "x")))).toBe(false);
    expect(new Address("a", "b").valueEquals(null)).toBe(false);
    expect(new Address("a", "b").valueEquals({ street: "a", city: "b" })).toBe(false);
  });
});

describe("Entity events", () => {
  it("builds closed event classes per entity that keep the .NET inheritance", () => {
    const created = EntityCreatedEventData.of(Book);
    expect(created).toBe(EntityCreatedEventData.of(Book));
    expect(created).not.toBe(EntityCreatedEventData.of(Product));
    expect(created.name).toBe("EntityCreatedEventData<Book>");
    expect(EntityEventData.entityTypeOf(created)).toBe(Book);

    const event = new created(new Book(id1));
    expect(event).toBeInstanceOf(EntityCreatedEventData);
    expect(event).toBeInstanceOf(EntityChangedEventData);
    expect(event).toBeInstanceOf(EntityChangedEventData.of(Book));
    expect(event).toBeInstanceOf(EntityEventData.of(Book));
    expect(event).not.toBeInstanceOf(EntityUpdatedEventData.of(Book));
    expect(event).not.toBeInstanceOf(EntityCreatedEventData.of(Product));
    expect(created.prototype instanceof EntityChangedEventData.of(Book)).toBe(true);
    expect(EntityUpdatedEventData.of(Book).prototype instanceof created).toBe(false);
    expect(event.isMultiTenant()).toEqual({ isMultiTenant: false });
    expect(new (EntityCreatedEventData.of(TenantBook))(new TenantBook(id1, "t1")).isMultiTenant()).toEqual({ isMultiTenant: true, tenantId: "t1" });
  });

  it("names ETO events after the ETO with the .NET postfix", () => {
    const created = EntityCreatedEto.of(EntityEto);
    expect(created).toBe(EntityCreatedEto.of(EntityEto));
    expect(EventNameAttribute.getNameOrDefault(created)).toBe("EntityEto.Created");
    const eto = new EntityEto("Book", id1);
    eto.tenantId = "t1";
    expect(new created(eto).isMultiTenant()).toEqual({ isMultiTenant: true, tenantId: "t1" });
  });
});

describe("EntityNotFoundException", () => {
  it("carries the entity type and id", () => {
    const e = new EntityNotFoundException(Book, id1);
    expect(e.entityType).toBe(Book);
    expect(e.id).toBe(id1);
    expect(e.message).toBe(`There is no such an entity. Entity type: Book, id: ${id1}`);
    expect(e.name).toBe("EntityNotFoundException");
    expect(new EntityNotFoundException(Book).message).toContain("Entity type: Book");
    expect(new EntityNotFoundException().message).toBe("There is no such an entity!");
  });
});
