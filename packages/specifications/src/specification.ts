import { Check } from "@abp/core";

/** Port of `Expression<Func<T, bool>>`: predicates are plain functions, the runtime has no expression trees. */
export type Expression<T> = (obj: T) => boolean;

/** Port of `ISpecification<T>` (http://martinfowler.com/apsupp/spec.pdf). */
export interface ISpecification<T> {
  isSatisfiedBy(obj: T): boolean;
  toExpression(): Expression<T>;
}

/** Port of `ICompositeSpecification<T>`: keeps both sides so an `ISpecificationParser` can walk the tree. */
export interface ICompositeSpecification<T> extends ISpecification<T> {
  readonly left: ISpecification<T>;
  readonly right: ISpecification<T>;
}

/**
 * Port of `ISpecificationParser<TCriteria>`: translates a specification tree into a store-specific criteria
 * object (e.g. a DynamoDB filter expression).
 */
export interface ISpecificationParser<TCriteria> {
  parse<T>(specification: ISpecification<T>): TCriteria;
}

/** Port of `ExpressionFuncExtender`. */
export const ExpressionFuncExtender = {
  and<T>(first: Expression<T>, second: Expression<T>): Expression<T> {
    return (obj) => first(obj) && second(obj);
  },
  or<T>(first: Expression<T>, second: Expression<T>): Expression<T> {
    return (obj) => first(obj) || second(obj);
  },
  not<T>(expression: Expression<T>): Expression<T> {
    return (obj) => !expression(obj);
  },
};

/** Port of `Specification<T>`; the `SpecificationExtensions` become instance methods (`and`, `or`, `not`, `andNot`). */
export abstract class Specification<T> implements ISpecification<T> {
  isSatisfiedBy(obj: T): boolean {
    return this.toExpression()(obj);
  }

  abstract toExpression(): Expression<T>;

  and(other: ISpecification<T>): ISpecification<T> {
    return SpecificationExtensions.and(this, other);
  }

  or(other: ISpecification<T>): ISpecification<T> {
    return SpecificationExtensions.or(this, other);
  }

  andNot(other: ISpecification<T>): ISpecification<T> {
    return SpecificationExtensions.andNot(this, other);
  }

  not(): ISpecification<T> {
    return SpecificationExtensions.not(this);
  }
}

export abstract class CompositeSpecification<T> extends Specification<T> implements ICompositeSpecification<T> {
  protected constructor(
    readonly left: ISpecification<T>,
    readonly right: ISpecification<T>,
  ) {
    super();
  }
}

export class AndSpecification<T> extends CompositeSpecification<T> {
  constructor(left: ISpecification<T>, right: ISpecification<T>) {
    super(left, right);
  }
  toExpression(): Expression<T> {
    return ExpressionFuncExtender.and(this.left.toExpression(), this.right.toExpression());
  }
}

export class OrSpecification<T> extends CompositeSpecification<T> {
  constructor(left: ISpecification<T>, right: ISpecification<T>) {
    super(left, right);
  }
  toExpression(): Expression<T> {
    return ExpressionFuncExtender.or(this.left.toExpression(), this.right.toExpression());
  }
}

export class AndNotSpecification<T> extends CompositeSpecification<T> {
  constructor(left: ISpecification<T>, right: ISpecification<T>) {
    super(left, right);
  }
  toExpression(): Expression<T> {
    return ExpressionFuncExtender.and(this.left.toExpression(), ExpressionFuncExtender.not(this.right.toExpression()));
  }
}

export class NotSpecification<T> extends Specification<T> {
  constructor(readonly specification: ISpecification<T>) {
    super();
  }
  toExpression(): Expression<T> {
    return ExpressionFuncExtender.not(this.specification.toExpression());
  }
}

export class ExpressionSpecification<T> extends Specification<T> {
  constructor(private readonly expression: Expression<T>) {
    super();
  }
  toExpression(): Expression<T> {
    return this.expression;
  }
}

export class AnySpecification<T> extends Specification<T> {
  toExpression(): Expression<T> {
    return () => true;
  }
}

export class NoneSpecification<T> extends Specification<T> {
  toExpression(): Expression<T> {
    return () => false;
  }
}

/** Port of `SpecificationExtensions` for any `ISpecification<T>` (interfaces cannot carry extension methods). */
export const SpecificationExtensions = {
  and<T>(specification: ISpecification<T>, other: ISpecification<T>): ISpecification<T> {
    Check.notNull(specification, "specification");
    Check.notNull(other, "other");
    return new AndSpecification(specification, other);
  },
  or<T>(specification: ISpecification<T>, other: ISpecification<T>): ISpecification<T> {
    Check.notNull(specification, "specification");
    Check.notNull(other, "other");
    return new OrSpecification(specification, other);
  },
  andNot<T>(specification: ISpecification<T>, other: ISpecification<T>): ISpecification<T> {
    Check.notNull(specification, "specification");
    Check.notNull(other, "other");
    return new AndNotSpecification(specification, other);
  },
  not<T>(specification: ISpecification<T>): ISpecification<T> {
    Check.notNull(specification, "specification");
    return new NotSpecification(specification);
  },
};
