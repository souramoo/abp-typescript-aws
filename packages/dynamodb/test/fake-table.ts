import type { BatchWriteCommandInput, DeleteCommandInput, GetCommandInput, PutCommandInput, QueryCommandInput, TransactWriteCommandInput, UpdateCommandInput } from "@aws-sdk/lib-dynamodb";

type Item = Record<string, unknown>;
type Names = Record<string, string>;
type Values = Record<string, unknown>;

/** Enough of DynamoDB's expression grammar for the expressions this package generates. */
class ExpressionEvaluator {
  private readonly tokens: string[];
  private position = 0;

  constructor(
    expression: string,
    private readonly item: Item | undefined,
    private readonly names: Names,
    private readonly values: Values,
  ) {
    this.tokens = expression.match(/#\w+|:\w+|\(|\)|,|<=|>=|<>|=|<|>|\w+/g) ?? [];
  }

  evaluate(): boolean {
    const result = this.parseOr();
    if (this.position !== this.tokens.length) throw new Error(`Unexpected token ${this.tokens[this.position]} in expression`);
    return result;
  }

  private peek(): string | undefined {
    return this.tokens[this.position];
  }

  private next(): string {
    const token = this.tokens[this.position++];
    if (token === undefined) throw new Error("Unexpected end of expression");
    return token;
  }

  private expect(token: string): void {
    const actual = this.next();
    if (actual.toUpperCase() !== token) throw new Error(`Expected ${token} but found ${actual}`);
  }

  private parseOr(): boolean {
    let result = this.parseAnd();
    while (this.peek()?.toUpperCase() === "OR") {
      this.next();
      const right = this.parseAnd();
      result = result || right;
    }
    return result;
  }

  private parseAnd(): boolean {
    let result = this.parseUnary();
    while (this.peek()?.toUpperCase() === "AND") {
      this.next();
      const right = this.parseUnary();
      result = result && right;
    }
    return result;
  }

  private parseUnary(): boolean {
    const token = this.peek();
    if (token?.toUpperCase() === "NOT") {
      this.next();
      return !this.parseUnary();
    }
    if (token === "(") {
      this.next();
      const result = this.parseOr();
      this.expect(")");
      return result;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): boolean {
    const token = this.next();
    const fn = token.toLowerCase();
    if (fn === "attribute_exists" || fn === "attribute_not_exists" || fn === "begins_with") {
      this.expect("(");
      const attribute = this.operand(this.next());
      let argument: unknown;
      if (fn === "begins_with") {
        this.expect(",");
        argument = this.operand(this.next());
      }
      this.expect(")");
      if (fn === "attribute_exists") return attribute !== undefined;
      if (fn === "attribute_not_exists") return attribute === undefined;
      return typeof attribute === "string" && typeof argument === "string" && attribute.startsWith(argument);
    }
    const left = this.operand(token);
    const operator = this.next().toUpperCase();
    if (operator === "BETWEEN") {
      const low = this.operand(this.next());
      this.expect("AND");
      const high = this.operand(this.next());
      return compare(left, low) >= 0 && compare(left, high) <= 0;
    }
    const right = this.operand(this.next());
    switch (operator) {
      case "=":
        return left === right;
      case "<>":
        return left !== right;
      case "<":
        return compare(left, right) < 0;
      case "<=":
        return compare(left, right) <= 0;
      case ">":
        return compare(left, right) > 0;
      case ">=":
        return compare(left, right) >= 0;
      default:
        throw new Error(`Unsupported operator ${operator}`);
    }
  }

  private operand(token: string): unknown {
    if (token.startsWith("#")) {
      const name = this.names[token];
      if (name === undefined) throw new Error(`Unknown attribute name ${token}`);
      return this.item?.[name];
    }
    if (token.startsWith(":")) {
      if (!(token in this.values)) throw new Error(`Unknown attribute value ${token}`);
      return this.values[token];
    }
    throw new Error(`Unexpected operand ${token}`);
  }
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function evaluate(expression: string | undefined, item: Item | undefined, names: Names | undefined, values: Values | undefined): boolean {
  if (!expression) return true;
  return new ExpressionEvaluator(expression, item, names ?? {}, values ?? {}).evaluate();
}

function conditionalCheckFailed(): Error {
  return Object.assign(new Error("The conditional request failed"), { name: "ConditionalCheckFailedException" });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** An in-memory single table with `pk`/`sk` and `gsiNpk`/`gsiNsk` indexes, driven through `aws-sdk-client-mock`. */
export class FakeTable {
  readonly items = new Map<string, Item>();

  private keyOf(key: Item | undefined): string {
    return `${String(key?.["pk"])}|${String(key?.["sk"])}`;
  }

  get(input: GetCommandInput): { Item?: Item } {
    const item = this.items.get(this.keyOf(input.Key));
    return item ? { Item: clone(item) } : {};
  }

  put(input: PutCommandInput): Item {
    const item = input.Item ?? {};
    const existing = this.items.get(this.keyOf(item));
    if (!evaluate(input.ConditionExpression, existing, input.ExpressionAttributeNames, input.ExpressionAttributeValues)) throw conditionalCheckFailed();
    this.items.set(this.keyOf(item), clone(item));
    return {};
  }

  delete(input: DeleteCommandInput): Item {
    const key = this.keyOf(input.Key);
    if (!evaluate(input.ConditionExpression, this.items.get(key), input.ExpressionAttributeNames, input.ExpressionAttributeValues)) throw conditionalCheckFailed();
    this.items.delete(key);
    return {};
  }

  update(input: UpdateCommandInput): Item {
    const key = this.keyOf(input.Key);
    const existing = this.items.get(key);
    if (!evaluate(input.ConditionExpression, existing, input.ExpressionAttributeNames, input.ExpressionAttributeValues)) throw conditionalCheckFailed();
    const updated = { ...(existing ?? {}), ...input.Key };
    const assignments = (input.UpdateExpression ?? "").replace(/^\s*SET\s+/i, "").split(",");
    for (const assignment of assignments) {
      const [name, value] = assignment.split("=").map((s) => s.trim());
      if (!name || !value) continue;
      updated[input.ExpressionAttributeNames?.[name] ?? name] = input.ExpressionAttributeValues?.[value];
    }
    this.items.set(key, updated);
    return {};
  }

  query(input: QueryCommandInput): { Items?: Item[]; Count: number; LastEvaluatedKey?: Item } {
    const index = input.IndexName;
    const pkAttribute = index ? `${index}pk` : "pk";
    const skAttribute = index ? `${index}sk` : "sk";
    let candidates = [...this.items.values()].filter((item) => item[pkAttribute] !== undefined && evaluate(input.KeyConditionExpression, item, input.ExpressionAttributeNames, input.ExpressionAttributeValues));
    candidates.sort((a, b) => compare(a[skAttribute], b[skAttribute]) || compare(a["pk"], b["pk"]));
    if (input.ScanIndexForward === false) candidates.reverse();

    if (input.ExclusiveStartKey) {
      const startKey = this.keyOf(input.ExclusiveStartKey);
      const position = candidates.findIndex((item) => this.keyOf(item) === startKey);
      candidates = candidates.slice(position + 1);
    }

    const limit = input.Limit ?? candidates.length;
    const page = candidates.slice(0, limit);
    const lastEvaluatedKey = candidates.length > limit && page.length > 0 ? { pk: page[page.length - 1]!["pk"], sk: page[page.length - 1]!["sk"] } : undefined;
    const matched = page.filter((item) => evaluate(input.FilterExpression, item, input.ExpressionAttributeNames, input.ExpressionAttributeValues));
    if (input.Select === "COUNT") return { Count: matched.length, LastEvaluatedKey: lastEvaluatedKey };
    return { Items: matched.map(clone), Count: matched.length, LastEvaluatedKey: lastEvaluatedKey };
  }

  transactWrite(input: TransactWriteCommandInput): Item {
    const operations = input.TransactItems ?? [];
    const reasons = operations.map((operation) => {
      if (operation.Put) {
        const existing = this.items.get(this.keyOf(operation.Put.Item));
        return evaluate(operation.Put.ConditionExpression, existing, operation.Put.ExpressionAttributeNames, operation.Put.ExpressionAttributeValues) ? { Code: "None" } : { Code: "ConditionalCheckFailed" };
      }
      if (operation.Delete) {
        const existing = this.items.get(this.keyOf(operation.Delete.Key));
        return evaluate(operation.Delete.ConditionExpression, existing, operation.Delete.ExpressionAttributeNames, operation.Delete.ExpressionAttributeValues) ? { Code: "None" } : { Code: "ConditionalCheckFailed" };
      }
      return { Code: "ValidationError" };
    });
    if (reasons.some((r) => r.Code !== "None")) {
      throw Object.assign(new Error("Transaction cancelled, please refer cancellation reasons for specific reasons"), { name: "TransactionCanceledException", CancellationReasons: reasons });
    }
    for (const operation of operations) {
      if (operation.Put?.Item) this.items.set(this.keyOf(operation.Put.Item), clone(operation.Put.Item));
      if (operation.Delete?.Key) this.items.delete(this.keyOf(operation.Delete.Key));
    }
    return {};
  }

  batchWrite(input: BatchWriteCommandInput): Item {
    for (const requests of Object.values(input.RequestItems ?? {})) {
      for (const request of requests) {
        if (request.PutRequest?.Item) this.items.set(this.keyOf(request.PutRequest.Item), clone(request.PutRequest.Item));
        if (request.DeleteRequest?.Key) this.items.delete(this.keyOf(request.DeleteRequest.Key));
      }
    }
    return {};
  }

  itemsOfType(entityType: string): Item[] {
    return [...this.items.values()].filter((item) => item["entityType"] === entityType);
  }
}
