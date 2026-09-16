import { RemoteService, getRemoteServiceMetadata, type Class, type ServiceKey } from "@abp/core";
import type { z } from "zod";

/** Primitive conversions for route/query/header values (port of the simple-type model binders). */
export type PrimitiveBindingType = "string" | "number" | "boolean" | "guid" | "date";

/** A DTO class carrying a zod `static schema`, or a bare zod schema. */
export type SchemaSource = z.ZodType | (Class & { schema?: z.ZodType }) | Class;

export interface ScalarBindingOptions {
  type?: PrimitiveBindingType;
  /** Validates/transforms the converted value (`z.string().min(1)`, `z.enum([...])`, …). */
  schema?: z.ZodType;
  optional?: boolean;
}

/** Port of `BindingSource`s as a discriminated union; created with `route()`, `query()`, `body()`, `header()`, `fromContext()`, `fromServices()`. */
export type ParameterBinding =
  | { readonly source: "route"; readonly name: string; readonly type: PrimitiveBindingType; readonly schema?: z.ZodType; readonly optional: boolean }
  | { readonly source: "query"; readonly name: string; readonly type: PrimitiveBindingType; readonly schema?: z.ZodType; readonly optional: boolean }
  | { readonly source: "queryObject"; readonly dto: SchemaSource | undefined }
  | { readonly source: "body"; readonly dto: SchemaSource | undefined; readonly optional: boolean }
  | { readonly source: "form"; readonly dto: SchemaSource | undefined }
  | { readonly source: "header"; readonly name: string; readonly type: PrimitiveBindingType; readonly schema?: z.ZodType; readonly optional: boolean }
  | { readonly source: "context" }
  | { readonly source: "services"; readonly key: ServiceKey };

/** `[FromRoute] id` → `route("id")`; `route("id", { type: "guid" })`. */
export function route(name: string, options: ScalarBindingOptions = {}): ParameterBinding {
  return { source: "route", name, type: options.type ?? "string", schema: options.schema, optional: options.optional ?? false };
}

/** `[FromQuery] input` → `query(GetListInput)` (whole query bound to the DTO) or `query("filter", { type: "string" })` for one value. */
export function query(nameOrDto?: string | SchemaSource, options: ScalarBindingOptions = {}): ParameterBinding {
  if (typeof nameOrDto === "string") return { source: "query", name: nameOrDto, type: options.type ?? "string", schema: options.schema, optional: options.optional ?? true };
  return { source: "queryObject", dto: nameOrDto };
}

/** `[FromBody] input` → `body(CreateDto)`; `body()` passes the parsed JSON through untyped. */
export function body(dto?: SchemaSource, options: { optional?: boolean } = {}): ParameterBinding {
  return { source: "body", dto, optional: options.optional ?? false };
}

/** `[FromForm] input` → `form(Dto)`: application/x-www-form-urlencoded bodies. */
export function form(dto?: SchemaSource): ParameterBinding {
  return { source: "form", dto };
}

/** `[FromHeader(Name = "x-foo")]` → `header("x-foo")`. */
export function header(name: string, options: ScalarBindingOptions = {}): ParameterBinding {
  return { source: "header", name, type: options.type ?? "string", schema: options.schema, optional: options.optional ?? true };
}

/** Injects the `AbpHttpContext` itself. */
export function fromContext(): ParameterBinding {
  return { source: "context" };
}

/** `[FromServices]` → resolves the key from the request scope. */
export function fromServices(key: ServiceKey): ParameterBinding {
  return { source: "services", key };
}

/** Port of `RouteAttribute` + `AreaAttribute` + `RemoteServiceAttribute` on a controller. */
export interface ControllerOptions {
  /** `[RemoteService(Name = "...")]`: the remote service the controller belongs to (client proxy grouping). */
  remoteServiceName?: string;
  /** `[Area("abp")]`: the module root path in the API description. */
  area?: string;
  /** `[RemoteService(IsEnabled = false)]` hides the controller from the API description. */
  isRemoteServiceEnabled?: boolean;
  isMetadataEnabled?: boolean;
  /** `[ApiExplorerSettings(GroupName = ...)]`. */
  groupName?: string;
}

export interface ControllerMetadata extends ControllerOptions {
  readonly route: string;
}

export interface ActionMetadata {
  readonly name: string;
  readonly httpMethod: string;
  /** Template relative to the controller route (`""`, `":id"`, `"by-name/:name"`), or absolute when starting with `/` or `~/`. */
  readonly template: string;
  readonly bindings: readonly ParameterBinding[];
}

const controllerMetadata = new WeakMap<Class, ControllerMetadata>();
const actionMetadata = new WeakMap<object, ActionMetadata[]>();

/**
 * Port of `[Route("api/...")]` (+ `[Area]`/`[RemoteService]`) as a class decorator. Controllers are plain classes
 * resolved from the request scope, so they need a DI registration too (`@Transient()`, or the MVC module registers them).
 */
export function Controller(routeTemplate: string, options: ControllerOptions = {}) {
  return (target: Class): void => {
    controllerMetadata.set(target, { ...options, route: routeTemplate });
    if (!getRemoteServiceMetadata(target)) RemoteService({ name: options.remoteServiceName, isEnabled: options.isRemoteServiceEnabled ?? true, isMetadataEnabled: options.isMetadataEnabled ?? true })(target);
  };
}

export function getControllerMetadata(type: Class | undefined): ControllerMetadata | undefined {
  let current: unknown = type;
  while (typeof current === "function" && current !== Function.prototype) {
    const metadata = controllerMetadata.get(current as Class);
    if (metadata) return metadata;
    current = Object.getPrototypeOf(current);
  }
  return undefined;
}

export function isController(type: Class): boolean {
  return controllerMetadata.has(type);
}

type MethodDecorator = (target: object, propertyKey: string | symbol, descriptor?: PropertyDescriptor) => void;

function httpMethodDecorator(httpMethod: string, template: string | undefined, bindings: readonly ParameterBinding[]): MethodDecorator {
  return (target, propertyKey) => {
    const list = actionMetadata.get(target) ?? [];
    list.push({ name: String(propertyKey), httpMethod, template: template ?? "", bindings });
    actionMetadata.set(target, list);
  };
}

/** Port of `[HttpGet(template)]`; bindings describe the action parameters positionally (TypeScript keeps no parameter names). */
export function HttpGet(template?: string, ...bindings: ParameterBinding[]): MethodDecorator {
  return httpMethodDecorator("GET", template, bindings);
}
export function HttpPost(template?: string, ...bindings: ParameterBinding[]): MethodDecorator {
  return httpMethodDecorator("POST", template, bindings);
}
export function HttpPut(template?: string, ...bindings: ParameterBinding[]): MethodDecorator {
  return httpMethodDecorator("PUT", template, bindings);
}
export function HttpDelete(template?: string, ...bindings: ParameterBinding[]): MethodDecorator {
  return httpMethodDecorator("DELETE", template, bindings);
}
export function HttpPatch(template?: string, ...bindings: ParameterBinding[]): MethodDecorator {
  return httpMethodDecorator("PATCH", template, bindings);
}
export function HttpHead(template?: string, ...bindings: ParameterBinding[]): MethodDecorator {
  return httpMethodDecorator("HEAD", template, bindings);
}
export function HttpOptions(template?: string, ...bindings: ParameterBinding[]): MethodDecorator {
  return httpMethodDecorator("OPTIONS", template, bindings);
}
/** `[AcceptVerbs(...)]` / custom verbs. */
export function HttpMethod(httpMethod: string, template?: string, ...bindings: ParameterBinding[]): MethodDecorator {
  return httpMethodDecorator(httpMethod.toUpperCase(), template, bindings);
}

/** All actions of a controller class, base classes included (an overriding method re-declared with a decorator wins). */
export function getActions(type: Class): ActionMetadata[] {
  const actions = new Map<string, ActionMetadata[]>();
  const chain: object[] = [];
  let proto: unknown = type.prototype;
  while (proto && proto !== Object.prototype) {
    chain.unshift(proto as object);
    proto = Object.getPrototypeOf(proto);
  }
  for (const level of chain) {
    const declared = actionMetadata.get(level) ?? [];
    const byName = new Map<string, ActionMetadata[]>();
    for (const action of declared) byName.set(action.name, [...(byName.get(action.name) ?? []), action]);
    for (const [name, list] of byName) actions.set(name, list);
  }
  return [...actions.values()].flat();
}
