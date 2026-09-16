import { AbpException, type Class } from "@abp/core";
import type { RouteEndpoint } from "../http-context.js";
import { getActions, getControllerMetadata, type ActionMetadata, type ControllerMetadata } from "./controller.js";

interface RouteSegment {
  readonly kind: "literal" | "parameter";
  readonly value: string;
  readonly optional: boolean;
  readonly catchAll: boolean;
}

/** One routable action (port of `RouteEndpoint` + `HttpMethodMetadata`). */
export interface RouteEntry {
  readonly controllerType: Class;
  readonly controller: ControllerMetadata;
  readonly action: ActionMetadata;
  readonly template: string;
  readonly segments: readonly RouteSegment[];
  readonly httpMethod: string;
}

export type RouteMatch =
  | { readonly kind: "matched"; readonly endpoint: RouteEndpoint; readonly entry: RouteEntry }
  | { readonly kind: "methodNotAllowed"; readonly allowedMethods: readonly string[] }
  | { readonly kind: "notFound" };

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

/** Accepts `:id`, `{id}`, `{id:guid}`, `{id?}`, `{*path}` and `:id?` forms. */
function parseSegment(raw: string): RouteSegment {
  let text = raw;
  let catchAll = false;
  if (text.startsWith("{") && text.endsWith("}")) {
    text = text.slice(1, -1);
    if (text.startsWith("*")) {
      catchAll = true;
      text = text.replace(/^\*+/, "");
    }
    const optional = text.endsWith("?");
    if (optional) text = text.slice(0, -1);
    const name = text.split(":")[0]!.split("=")[0]!;
    return { kind: "parameter", value: name, optional, catchAll };
  }
  if (text.startsWith(":")) {
    text = text.slice(1);
    const optional = text.endsWith("?");
    if (optional) text = text.slice(0, -1);
    return { kind: "parameter", value: text, optional, catchAll };
  }
  return { kind: "literal", value: text.toLowerCase(), optional: false, catchAll: false };
}

function combineTemplates(controllerRoute: string, actionTemplate: string): string {
  if (actionTemplate.startsWith("~/")) return trimSlashes(actionTemplate.slice(2));
  if (actionTemplate.startsWith("/")) return trimSlashes(actionTemplate);
  const controller = trimSlashes(controllerRoute);
  const action = trimSlashes(actionTemplate);
  return [controller, action].filter((part) => part !== "").join("/");
}

/** Builds the route table of a set of controllers (port of the attribute routing part of `AbpServiceConvention`). */
export function buildRouteTable(controllerTypes: Iterable<Class>): RouteEntry[] {
  const entries: RouteEntry[] = [];
  for (const controllerType of controllerTypes) {
    const controller = getControllerMetadata(controllerType);
    if (!controller) throw new AbpException(`${controllerType.name} is not decorated with @Controller(...).`);
    for (const action of getActions(controllerType)) {
      const template = combineTemplates(controller.route, action.template);
      const segments = template === "" ? [] : template.split("/").map(parseSegment);
      entries.push({ controllerType, controller, action, template, segments, httpMethod: action.httpMethod });
    }
  }
  return entries.sort(compareSpecificity);
}

/** Literal segments beat parameters, longer templates beat shorter ones (port of route precedence). */
function compareSpecificity(a: RouteEntry, b: RouteEntry): number {
  const length = Math.max(a.segments.length, b.segments.length);
  for (let i = 0; i < length; i++) {
    const sa = a.segments[i];
    const sb = b.segments[i];
    if (!sa || !sb) return sa ? -1 : sb ? 1 : 0;
    const ra = rank(sa);
    const rb = rank(sb);
    if (ra !== rb) return ra - rb;
  }
  return 0;
}

function rank(segment: RouteSegment): number {
  if (segment.kind === "literal") return 0;
  if (segment.catchAll) return 3;
  return segment.optional ? 2 : 1;
}

function matchSegments(entry: RouteEntry, pathSegments: readonly string[]): Record<string, string> | undefined {
  const values: Record<string, string> = {};
  let i = 0;
  for (; i < entry.segments.length; i++) {
    const segment = entry.segments[i]!;
    const actual = pathSegments[i];
    if (segment.catchAll) {
      const rest = pathSegments.slice(i).map(safeDecode).join("/");
      if (rest === "" && !segment.optional) return undefined;
      values[segment.value] = rest;
      return values;
    }
    if (actual === undefined) {
      if (segment.optional) continue;
      return undefined;
    }
    if (segment.kind === "literal") {
      if (actual.toLowerCase() !== segment.value) return undefined;
      continue;
    }
    if (actual === "") return undefined;
    values[segment.value] = safeDecode(actual);
  }
  return i >= pathSegments.length ? values : undefined;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Port of the endpoint matcher: case-insensitive, optional trailing slash, 405 when only the verb differs. */
export class Router {
  constructor(private readonly entries: readonly RouteEntry[]) {}

  get routes(): readonly RouteEntry[] {
    return this.entries;
  }

  match(method: string, rawPath: string): RouteMatch {
    const path = trimSlashes(rawPath);
    const pathSegments = path === "" ? [] : path.split("/");
    const verb = method.toUpperCase();
    const allowed = new Set<string>();

    for (const entry of this.entries) {
      const values = matchSegments(entry, pathSegments);
      if (!values) continue;
      if (entry.httpMethod !== verb && !(verb === "HEAD" && entry.httpMethod === "GET")) {
        allowed.add(entry.httpMethod);
        continue;
      }
      const metadata = new Map<string, unknown>();
      const endpoint: RouteEndpoint = { controllerType: entry.controllerType, actionName: entry.action.name, httpMethod: entry.httpMethod, routeTemplate: entry.template, routeValues: values, metadata };
      return { kind: "matched", endpoint, entry };
    }

    return allowed.size > 0 ? { kind: "methodNotAllowed", allowedMethods: [...allowed] } : { kind: "notFound" };
  }
}
