import { AbpException, Check, CultureHelper, IStringLocalizerFactory, Transient, isNullOrWhiteSpace, type IStringLocalizer } from "@abp/core";
import { ITemplateContentProvider } from "./template-content-provider.js";
import type { TemplateDefinition } from "./template-definition.js";
import { ITemplateDefinitionManager } from "./template-definition-store.js";
import { TemplateRenderingEngineBase, type TemplateGlobalContext } from "./template-rendering-engine.js";

type Expression = { kind: "path"; segments: string[] } | { kind: "literal"; value: string | number | boolean | null } | { kind: "call"; name: string; args: Expression[] } | { kind: "filter"; input: Expression; filters: string[] };

type Node = { type: "text"; value: string } | { type: "interpolate"; expression: Expression } | { type: "if"; condition: Expression; then: Node[]; else: Node[] } | { type: "each"; items: Expression; body: Node[]; else: Node[] };

interface Frame {
  readonly value: unknown;
  readonly specials?: Record<string, unknown>;
}

const forbiddenSegments = new Set(["__proto__", "constructor", "prototype"]);

const filters: Record<string, (value: unknown) => unknown> = {
  escape: (value) => escapeHtml(stringify(value)),
  html: (value) => escapeHtml(stringify(value)),
  upcase: (value) => stringify(value).toUpperCase(),
  downcase: (value) => stringify(value).toLowerCase(),
  trim: (value) => stringify(value).trim(),
  json: (value) => JSON.stringify(value),
  size: (value) => (Array.isArray(value) || typeof value === "string" ? value.length : value instanceof Map || value instanceof Set ? value.size : 0),
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stringify).join(",");
  return String(value);
}

function isTruthy(value: unknown): boolean {
  if (value === undefined || value === null || value === false || value === 0 || value === "") return false;
  if (typeof value === "number" && Number.isNaN(value)) return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Splits an expression into tokens: quoted strings, `|`, and bare words. */
function tokenize(expression: string): string[] {
  const tokens: string[] = [];
  const regex = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\|)|([^\s|]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(expression)) !== null) {
    if (match[1] !== undefined) tokens.push(`"${match[1]}`);
    else if (match[2] !== undefined) tokens.push(`"${match[2]}`);
    else if (match[3] !== undefined) tokens.push("|");
    else tokens.push(match[4]!);
  }
  return tokens;
}

function parseOperand(token: string): Expression {
  if (token.startsWith('"')) return { kind: "literal", value: token.slice(1).replace(/\\(.)/g, "$1") };
  if (token === "true") return { kind: "literal", value: true };
  if (token === "false") return { kind: "literal", value: false };
  if (token === "null") return { kind: "literal", value: null };
  if (/^-?\d+(\.\d+)?$/.test(token)) return { kind: "literal", value: Number(token) };
  const segments = token.split(".");
  for (const segment of segments) {
    if (segment === "" || forbiddenSegments.has(segment)) throw new AbpException(`Invalid template expression: ${token}`);
  }
  return { kind: "path", segments };
}

function parseExpression(text: string): Expression {
  const tokens = tokenize(text);
  if (tokens.length === 0) throw new AbpException("Empty template expression.");
  const pipeIndex = tokens.indexOf("|");
  const head = pipeIndex < 0 ? tokens : tokens.slice(0, pipeIndex);
  const filterNames = pipeIndex < 0 ? [] : tokens.slice(pipeIndex + 1).filter((t) => t !== "|");

  let expression: Expression;
  if (head.length === 1) {
    expression = parseOperand(head[0]!);
  } else {
    const [name, ...args] = head;
    if (name!.startsWith('"') || name!.includes(".")) throw new AbpException(`Invalid template expression: ${text}`);
    expression = { kind: "call", name: name!, args: args.map(parseOperand) };
  }
  for (const name of filterNames) {
    if (!(name in filters)) throw new AbpException(`Unknown template filter: ${name}`);
  }
  return filterNames.length === 0 ? expression : { kind: "filter", input: expression, filters: filterNames };
}

interface OpenBlock {
  readonly node: Extract<Node, { type: "if" | "each" }>;
  target: Node[];
}

/** Parses template text into an AST; `{{ }}`, `{{{ }}}`, `{{! }}`, `{{#if}}`, `{{else}}`, `{{/if}}`, `{{#each}}`, `{{/each}}`. */
function parse(template: string): Node[] {
  const root: Node[] = [];
  const stack: OpenBlock[] = [];
  const current = () => (stack.length === 0 ? root : stack[stack.length - 1]!.target);
  const tagRegex = /\{\{\{\s*([\s\S]*?)\s*\}\}\}|\{\{\s*([\s\S]*?)\s*\}\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(template)) !== null) {
    if (match.index > lastIndex) current().push({ type: "text", value: template.slice(lastIndex, match.index) });
    lastIndex = tagRegex.lastIndex;
    const content = (match[1] ?? match[2] ?? "").trim();

    if (content.startsWith("!")) continue;
    if (content.startsWith("#if ")) {
      const node: Node = { type: "if", condition: parseExpression(content.slice(4)), then: [], else: [] };
      current().push(node);
      stack.push({ node, target: node.then });
    } else if (content.startsWith("#each ")) {
      const node: Node = { type: "each", items: parseExpression(content.slice(6)), body: [], else: [] };
      current().push(node);
      stack.push({ node, target: node.body });
    } else if (content === "else") {
      const open = stack[stack.length - 1];
      if (!open) throw new AbpException("Unexpected {{else}} outside of a block.");
      open.target = open.node.else;
    } else if (content === "/if" || content === "/each") {
      const open = stack.pop();
      const expected = content === "/if" ? "if" : "each";
      if (!open || open.node.type !== expected) throw new AbpException(`Unexpected {{${content}}}: no open {{#${expected}}} block.`);
    } else {
      current().push({ type: "interpolate", expression: parseExpression(content) });
    }
  }
  if (stack.length > 0) throw new AbpException(`Unclosed {{#${stack[stack.length - 1]!.node.type}}} block.`);
  if (lastIndex < template.length) current().push({ type: "text", value: template.slice(lastIndex) });
  return root;
}

function readProperty(target: unknown, segment: string): { found: boolean; value: unknown } {
  if (target === null || target === undefined) return { found: false, value: undefined };
  if (target instanceof Map) return target.has(segment) ? { found: true, value: target.get(segment) } : { found: false, value: undefined };
  if (typeof target !== "object" && typeof target !== "function") return { found: false, value: undefined };
  if (!(segment in (target as object))) return { found: false, value: undefined };
  const value: unknown = Reflect.get(target as object, segment);
  return { found: true, value: typeof value === "function" ? undefined : value };
}

class Renderer {
  constructor(
    private readonly frames: Frame[],
    private readonly localizer: IStringLocalizer | undefined,
  ) {}

  render(nodes: readonly Node[]): string {
    let output = "";
    for (const node of nodes) {
      switch (node.type) {
        case "text":
          output += node.value;
          break;
        case "interpolate":
          output += stringify(this.evaluate(node.expression));
          break;
        case "if":
          output += this.render(isTruthy(this.evaluate(node.condition)) ? node.then : node.else);
          break;
        case "each":
          output += this.renderEach(node);
          break;
        default: {
          const _exhaustive: never = node;
          throw new AbpException(`Unknown template node: ${String(_exhaustive)}`);
        }
      }
    }
    return output;
  }

  private renderEach(node: Extract<Node, { type: "each" }>): string {
    const items = this.toArray(this.evaluate(node.items));
    if (items.length === 0) return this.render(node.else);
    let output = "";
    items.forEach((item, index) => {
      this.frames.push({ value: item, specials: { this: item, "@index": index, "@first": index === 0, "@last": index === items.length - 1 } });
      try {
        output += this.render(node.body);
      } finally {
        this.frames.pop();
      }
    });
    return output;
  }

  private toArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (value instanceof Set) return [...value];
    if (value instanceof Map) return [...value.entries()].map(([key, item]) => ({ key, value: item }));
    if (value === null || value === undefined) return [];
    if (typeof value === "object" && Symbol.iterator in value) return [...(value as Iterable<unknown>)];
    return [];
  }

  evaluate(expression: Expression): unknown {
    switch (expression.kind) {
      case "literal":
        return expression.value;
      case "path":
        return this.resolvePath(expression.segments);
      case "call":
        return this.call(expression.name, expression.args.map((a) => this.evaluate(a)));
      case "filter": {
        let value = this.evaluate(expression.input);
        for (const name of expression.filters) value = filters[name]!(value);
        return value;
      }
      default: {
        const _exhaustive: never = expression;
        throw new AbpException(`Unknown template expression: ${String(_exhaustive)}`);
      }
    }
  }

  private call(name: string, args: unknown[]): unknown {
    if (name !== "L") throw new AbpException(`Unknown template function: ${name}`);
    const [key, ...rest] = args;
    const keyText = stringify(key);
    if (isNullOrWhiteSpace(keyText)) return "";
    const formatArgs = rest.filter((a) => a !== null && a !== undefined && !isNullOrWhiteSpace(stringify(a)));
    if (!this.localizer) return keyText;
    return this.localizer.get(keyText, ...formatArgs).value;
  }

  private resolvePath(segments: readonly string[]): unknown {
    const [first, ...rest] = segments;
    let current: unknown;
    let found = false;
    for (let i = this.frames.length - 1; i >= 0 && !found; i--) {
      const frame = this.frames[i]!;
      if (frame.specials && first! in frame.specials) {
        current = frame.specials[first!];
        found = true;
        break;
      }
      const property = readProperty(frame.value, first!);
      if (property.found) {
        current = property.value;
        found = true;
      }
    }
    if (!found) return undefined;
    for (const segment of rest) {
      const property = readProperty(current, segment);
      if (!property.found) return undefined;
      current = property.value;
    }
    return current;
  }
}

/**
 * The built-in rendering engine (the port's replacement for Scriban): `{{ model.name }}`, `{{{ content }}}`,
 * `{{ L "Key" arg }}`, `{{#if x}}…{{else}}…{{/if}}`, `{{#each items}}…{{/each}}` (`this`, `@index`, `@first`,
 * `@last`), `{{! comment }}` and `{{ value | escape }}` filters. Like Scriban, interpolations are not HTML-escaped
 * unless the `escape`/`html` filter is applied; layouts receive the rendered content as `content`.
 */
@Transient()
export class MustacheLikeRenderingEngine extends TemplateRenderingEngineBase {
  static readonly EngineName = "MustacheLike";
  static override readonly inject = [ITemplateDefinitionManager, ITemplateContentProvider, IStringLocalizerFactory] as const;
  private static readonly parsedTemplates = new Map<string, Node[]>();

  readonly name = MustacheLikeRenderingEngine.EngineName;
  override readonly isSandboxed = true;

  async render(templateName: string, model?: unknown, cultureName?: string, globalContext?: TemplateGlobalContext): Promise<string> {
    Check.notNullOrWhiteSpace(templateName, "templateName");
    const context: TemplateGlobalContext = { ...(globalContext ?? {}) };
    if (cultureName === undefined) {
      this.setCultureContext(context);
      return this.renderInternal(templateName, context, model);
    }
    return CultureHelper.run(cultureName, () => {
      this.setCultureContext(context);
      return this.renderInternal(templateName, context, model);
    });
  }

  protected async renderInternal(templateName: string, globalContext: TemplateGlobalContext, model?: unknown): Promise<string> {
    const templateDefinition = await this.templateDefinitionManager.get(templateName);
    let renderedContent = await this.renderSingleTemplate(templateDefinition, globalContext, model);
    if (templateDefinition.layout !== undefined) {
      globalContext["content"] = renderedContent;
      renderedContent = await this.renderInternal(templateDefinition.layout, globalContext);
    }
    return renderedContent;
  }

  protected async renderSingleTemplate(templateDefinition: TemplateDefinition, globalContext: TemplateGlobalContext, model?: unknown): Promise<string> {
    const rawTemplateContent = await this.getContentOrNull(templateDefinition);
    if (rawTemplateContent === undefined) throw new AbpException(`No content found for the template: ${templateDefinition.name}`);
    return this.renderTemplateContent(templateDefinition, rawTemplateContent, globalContext, model);
  }

  protected renderTemplateContent(templateDefinition: TemplateDefinition, templateContent: string, globalContext: TemplateGlobalContext, model?: unknown): string {
    const root: Record<string, unknown> = { ...globalContext };
    if (model !== undefined && model !== null) root["model"] = model;
    const renderer = new Renderer([{ value: root }], this.getLocalizerOrNull(templateDefinition));
    return renderer.render(MustacheLikeRenderingEngine.parse(templateContent));
  }

  /** Parsed templates are cached by their text; the same content parses once per process. */
  static parse(templateContent: string): Node[] {
    let nodes = MustacheLikeRenderingEngine.parsedTemplates.get(templateContent);
    if (!nodes) {
      nodes = parse(templateContent);
      MustacheLikeRenderingEngine.parsedTemplates.set(templateContent, nodes);
    }
    return nodes;
  }
}

/** Port of `ScribanTemplateDefinitionExtensions.WithScribanEngine` for the built-in engine. */
export function withMustacheLikeEngine(templateDefinition: TemplateDefinition): TemplateDefinition {
  return templateDefinition.withRenderEngine(MustacheLikeRenderingEngine.EngineName);
}
