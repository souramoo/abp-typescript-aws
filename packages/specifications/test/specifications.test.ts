import { describe, expect, it } from "vitest";
import { AbpApplication } from "@abp/core";
import {
  AbpSpecificationsModule,
  AndNotSpecification,
  AndSpecification,
  AnySpecification,
  ExpressionFuncExtender,
  ExpressionSpecification,
  type ISpecification,
  type ISpecificationParser,
  NoneSpecification,
  NotSpecification,
  OrSpecification,
  Specification,
  SpecificationExtensions,
} from "../src/index.js";

class Customer {
  constructor(
    readonly name: string,
    readonly age: number,
    readonly balance: number,
  ) {}
}

class Age18PlusSpecification extends Specification<Customer> {
  toExpression() {
    return (c: Customer) => c.age >= 18;
  }
}
class PremiumSpecification extends Specification<Customer> {
  toExpression() {
    return (c: Customer) => c.balance > 1000;
  }
}

const john = new Customer("John", 30, 5000);
const kid = new Customer("Kid", 12, 0);
const poorAdult = new Customer("Bob", 40, 10);
const richKid = new Customer("Rich", 10, 100_000);
const all = [john, kid, poorAdult, richKid];

describe("Specification", () => {
  it("isSatisfiedBy evaluates the expression", () => {
    const spec = new Age18PlusSpecification();
    expect(spec.isSatisfiedBy(john)).toBe(true);
    expect(spec.isSatisfiedBy(kid)).toBe(false);
    expect(all.filter(spec.toExpression())).toEqual([john, poorAdult]);
  });

  it("composes with and / or / not / andNot", () => {
    const adult = new Age18PlusSpecification();
    const premium = new PremiumSpecification();
    expect(all.filter(adult.and(premium).toExpression())).toEqual([john]);
    expect(all.filter(adult.or(premium).toExpression())).toEqual([john, poorAdult, richKid]);
    expect(all.filter(adult.not().toExpression())).toEqual([kid, richKid]);
    expect(all.filter(adult.andNot(premium).toExpression())).toEqual([poorAdult]);
    expect(all.filter(premium.andNot(adult).toExpression())).toEqual([richKid]);
  });

  it("SpecificationExtensions work for any ISpecification", () => {
    const adult: ISpecification<Customer> = new Age18PlusSpecification();
    const premium: ISpecification<Customer> = new PremiumSpecification();
    expect(SpecificationExtensions.and(adult, premium)).toBeInstanceOf(AndSpecification);
    expect(SpecificationExtensions.or(adult, premium)).toBeInstanceOf(OrSpecification);
    expect(SpecificationExtensions.andNot(adult, premium)).toBeInstanceOf(AndNotSpecification);
    expect(SpecificationExtensions.not(adult)).toBeInstanceOf(NotSpecification);
    expect(SpecificationExtensions.and(adult, premium).isSatisfiedBy(john)).toBe(true);
    expect(SpecificationExtensions.not(adult).isSatisfiedBy(john)).toBe(false);
  });

  it("ExpressionSpecification, AnySpecification and NoneSpecification", () => {
    const named = new ExpressionSpecification<Customer>((c) => c.name.startsWith("J"));
    expect(all.filter(named.toExpression())).toEqual([john]);
    expect(all.every((c) => new AnySpecification<Customer>().isSatisfiedBy(c))).toBe(true);
    expect(all.some((c) => new NoneSpecification<Customer>().isSatisfiedBy(c))).toBe(false);
    expect(all.filter(named.or(new NoneSpecification()).toExpression())).toEqual([john]);
  });

  it("composite specifications expose left and right for parsers", () => {
    const composite = new Age18PlusSpecification().and(new PremiumSpecification());
    expect(composite).toBeInstanceOf(AndSpecification);
    const and = composite as AndSpecification<Customer>;
    expect(and.left).toBeInstanceOf(Age18PlusSpecification);
    expect(and.right).toBeInstanceOf(PremiumSpecification);

    const parser: ISpecificationParser<string> = {
      parse<T>(spec: ISpecification<T>): string {
        if (spec instanceof AndSpecification) return `(${this.parse(spec.left)} AND ${this.parse(spec.right)})`;
        if (spec instanceof NotSpecification) return `NOT ${this.parse(spec.specification)}`;
        return spec.constructor.name;
      },
    };
    expect(parser.parse(and.not())).toBe("NOT (Age18PlusSpecification AND PremiumSpecification)");
  });

  it("ExpressionFuncExtender combines predicates", () => {
    const even = (n: number) => n % 2 === 0;
    const big = (n: number) => n > 10;
    expect([2, 12, 13].filter(ExpressionFuncExtender.and(even, big))).toEqual([12]);
    expect([2, 12, 13].filter(ExpressionFuncExtender.or(even, big))).toEqual([2, 12, 13]);
    expect([2, 12, 13].filter(ExpressionFuncExtender.not(even))).toEqual([13]);
  });

  it("AbpSpecificationsModule loads", async () => {
    const app = await AbpApplication.create(AbpSpecificationsModule, { configuration: { skipDefaults: true } });
    await app.initialize();
    expect(app.modules.map((m) => m.type)).toEqual([AbpSpecificationsModule]);
    await app.shutdown();
  });
});
