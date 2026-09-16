import { describe, expect, it } from "vitest";
import { ExpressionSpecification } from "@abp/specifications";
import { ArrayQueryable, compareSortValues, executeQueryPlan, parseSorting, readSortValue } from "../src/index.js";

interface Item {
  id: number;
  name: string;
  price: number;
  createdAt: Date | undefined;
  Score?: number;
}

const items: Item[] = [
  { id: 1, name: "banana", price: 3, createdAt: new Date("2024-01-02"), Score: 2 },
  { id: 2, name: "apple", price: 1, createdAt: new Date("2024-01-03"), Score: 1 },
  { id: 3, name: "cherry", price: 3, createdAt: undefined, Score: 3 },
  { id: 4, name: "date", price: 2, createdAt: new Date("2024-01-01") },
];

const query = () => ArrayQueryable.from(items);

describe("parseSorting", () => {
  it("parses Dynamic LINQ style sorting strings", () => {
    expect(parseSorting("name")).toEqual([{ field: "name", direction: "asc" }]);
    expect(parseSorting(" Name DESC , price asc")).toEqual([
      { field: "Name", direction: "desc" },
      { field: "price", direction: "asc" },
    ]);
    expect(parseSorting(undefined)).toEqual([]);
    expect(parseSorting("  ")).toEqual([]);
    expect(() => parseSorting("name sideways")).toThrow(/Invalid sorting expression/);
    expect(() => parseSorting("name desc extra")).toThrow(/Invalid sorting expression/);
  });
});

describe("ArrayQueryable", () => {
  it("is immutable: builder calls return new queries", async () => {
    const base = query();
    const filtered = base.where((i) => i.price === 3);
    expect(base.plan.predicates).toHaveLength(0);
    expect(filtered.plan.predicates).toHaveLength(1);
    expect(await base.count()).toBe(4);
    expect(await filtered.count()).toBe(2);
  });

  it("filters with predicates and specifications", async () => {
    const cheap = new ExpressionSpecification<Item>((i) => i.price < 3);
    expect((await query().where(cheap).toList()).map((i) => i.id)).toEqual([2, 4]);
    expect((await query().where(cheap).where((i) => i.id > 2).toList()).map((i) => i.id)).toEqual([4]);
  });

  it("orders by field name (any casing), selector and multiple keys with a stable sort", async () => {
    expect((await query().orderBy("name").toList()).map((i) => i.name)).toEqual(["apple", "banana", "cherry", "date"]);
    expect((await query().orderBy("Name", "desc").toList()).map((i) => i.name)).toEqual(["date", "cherry", "banana", "apple"]);
    expect((await query().orderBy("price", "desc").thenBy("name").toList()).map((i) => i.id)).toEqual([1, 3, 4, 2]);
    expect((await query().orderBy((i) => i.name.length).thenBy("id", "desc").toList()).map((i) => i.id)).toEqual([4, 2, 3, 1]);
    expect((await query().orderBySorting("price desc, id desc").toList()).map((i) => i.id)).toEqual([3, 1, 4, 2]);
    expect((await query().orderBy("score").toList()).map((i) => i.id)).toEqual([4, 2, 1, 3]);
    expect((await query().orderBy("price").orderBy("id", "desc").toList()).map((i) => i.id)).toEqual([4, 3, 2, 1]);
    const unsorted = query();
    expect(unsorted.orderBySorting("")).toBe(unsorted);
  });

  it("sorts nulls first and dates by instant", async () => {
    expect((await query().orderBy("createdAt").toList()).map((i) => i.id)).toEqual([3, 4, 1, 2]);
    expect((await query().orderBy("createdAt", "desc").toList()).map((i) => i.id)).toEqual([2, 1, 4, 3]);
    expect(compareSortValues(true, false)).toBeGreaterThan(0);
    expect(compareSortValues(undefined, null)).toBe(0);
    expect(compareSortValues(10n, 2n)).toBeGreaterThan(0);
    expect(readSortValue({ FooBar: 1 }, "fooBar")).toBe(1);
    expect(readSortValue({ fooBar: 1 }, "FooBar")).toBe(1);
    expect(readSortValue(null, "x")).toBeUndefined();
  });

  it("pages with skip/take and counts the page like LINQ", async () => {
    const page = query().orderBy("id").skip(1).take(2);
    expect((await page.toList()).map((i) => i.id)).toEqual([2, 3]);
    expect(await page.count()).toBe(2);
    expect(await query().skip(10).any()).toBe(false);
    expect(await query().take(0).toList()).toEqual([]);
    expect(executeQueryPlan(items, { predicates: [], ordering: [], skipCount: 3, takeCount: 5 }).map((i) => i.id)).toEqual([4]);
  });

  it("implements first/single semantics", async () => {
    expect((await query().orderBy("price").first()).id).toBe(2);
    expect(await query().where((i) => i.id === 99).firstOrDefault()).toBeUndefined();
    await expect(query().where((i) => i.id === 99).first()).rejects.toThrow("Sequence contains no elements.");
    expect((await query().where((i) => i.id === 2).single()).name).toBe("apple");
    await expect(query().where((i) => i.price === 3).single()).rejects.toThrow("Sequence contains more than one element.");
    await expect(query().where((i) => i.price === 3).singleOrDefault()).rejects.toThrow(/more than one/);
    expect(await query().where((i) => i.id === 99).singleOrDefault()).toBeUndefined();
    expect(await query().any()).toBe(true);
  });

  it("supports lazy sources", async () => {
    let calls = 0;
    const lazy = ArrayQueryable.from(async () => {
      calls++;
      return items.slice(0, 2);
    });
    expect(calls).toBe(0);
    expect(await lazy.count()).toBe(2);
    expect((await lazy.where((i) => i.id === 2).toList()).map((i) => i.id)).toEqual([2]);
    expect(calls).toBe(2);
  });
});
