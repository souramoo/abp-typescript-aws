import { AbpAmbientKeys, AbpException, IAmbientScopeProvider, Singleton, createToken, type Class, type IServiceProvider } from "@abp/core";
import { IJsonSerializer, type JsonSchema } from "@abp/json";
import { HttpStatusCode, MimeTypes } from "@abp/http";
import type { TenantResolveResult } from "@abp/multi-tenancy-abstractions";
import { ClaimsIdentity, ClaimsPrincipal } from "@abp/security";

/** Case-insensitive header map (port of `IHeaderDictionary`). Values are joined with ", " when a header repeats. */
export class HttpHeaders implements Iterable<[string, string]> {
  private readonly map = new Map<string, string[]>();

  constructor(init?: Record<string, string | string[] | undefined> | Iterable<[string, string | string[] | undefined]>) {
    if (!init) return;
    const entries = Symbol.iterator in init ? init : Object.entries(init);
    for (const [name, value] of entries) {
      if (value === undefined) continue;
      this.append(name, value);
    }
  }

  get(name: string): string | undefined {
    const values = this.map.get(name.toLowerCase());
    return values && values.length > 0 ? values.join(", ") : undefined;
  }

  getAll(name: string): string[] {
    return [...(this.map.get(name.toLowerCase()) ?? [])];
  }

  has(name: string): boolean {
    return this.map.has(name.toLowerCase());
  }

  set(name: string, value: string | string[]): void {
    this.map.set(name.toLowerCase(), Array.isArray(value) ? [...value] : [value]);
  }

  append(name: string, value: string | string[]): void {
    const key = name.toLowerCase();
    const list = this.map.get(key) ?? [];
    list.push(...(Array.isArray(value) ? value : [value]));
    this.map.set(key, list);
  }

  delete(name: string): void {
    this.map.delete(name.toLowerCase());
  }

  /** `AddIfNotContains` semantics. */
  tryAdd(name: string, value: string): boolean {
    if (this.has(name)) return false;
    this.set(name, value);
    return true;
  }

  get size(): number {
    return this.map.size;
  }

  *[Symbol.iterator](): Iterator<[string, string]> {
    for (const [name, values] of this.map) yield [name, values.join(", ")];
  }

  toRecord(): Record<string, string> {
    return Object.fromEntries(this);
  }
}

/** Port of `CookieOptions`. */
export interface CookieOptions {
  path?: string;
  domain?: string;
  expires?: Date;
  /** Seconds. */
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export function parseCookieHeader(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name || cookies.has(name)) continue;
    cookies.set(name, safeDecode(part.slice(index + 1).trim()));
  }
  return cookies;
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? "/"}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join("; ");
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** What an adapter (API Gateway, node:http, tests) provides to build a request. */
export interface AbpHttpRequestInit {
  method: string;
  /** Path without query string (may be percent-encoded). */
  path: string;
  /** Query string without the leading `?`, or a ready `URLSearchParams`. */
  query?: string | URLSearchParams | Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined> | HttpHeaders;
  body?: string | Uint8Array;
  /** Base64-encoded `body` (API Gateway). */
  isBase64Encoded?: boolean;
  ip?: string;
  scheme?: string;
  host?: string;
}

/** Port of `HttpRequest` (the members an API host needs). */
export class AbpHttpRequest {
  readonly method: string;
  /** Decoded path, always starting with `/`. */
  readonly path: string;
  /** The path as received (percent-encoded). */
  readonly rawPath: string;
  readonly query: URLSearchParams;
  readonly headers: HttpHeaders;
  readonly bodyBytes: Uint8Array | undefined;
  readonly ip: string | undefined;
  readonly scheme: string;
  /** Route parameters filled by the routing middleware (`RouteData.Values`). */
  routeValues: Record<string, string> = {};
  private cookieCache: Map<string, string> | undefined;
  private bodyTextCache: string | undefined;

  constructor(init: AbpHttpRequestInit) {
    this.method = init.method.toUpperCase();
    this.rawPath = init.path.startsWith("/") ? init.path : `/${init.path}`;
    this.path = safeDecode(this.rawPath);
    this.query = toSearchParams(init.query);
    this.headers = init.headers instanceof HttpHeaders ? init.headers : new HttpHeaders(init.headers);
    this.bodyBytes = toBytes(init.body, init.isBase64Encoded ?? false);
    this.ip = init.ip;
    this.scheme = init.scheme ?? (this.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http");
    if (init.host) this.headers.tryAdd("host", init.host);
  }

  get host(): string | undefined {
    return this.headers.get("host");
  }

  get contentType(): string | undefined {
    return this.headers.get("content-type");
  }

  get userAgent(): string | undefined {
    return this.headers.get("user-agent");
  }

  get body(): string | undefined {
    if (this.bodyBytes === undefined) return undefined;
    this.bodyTextCache ??= Buffer.from(this.bodyBytes).toString("utf8");
    return this.bodyTextCache;
  }

  get hasBody(): boolean {
    return this.bodyBytes !== undefined && this.bodyBytes.length > 0;
  }

  get cookies(): ReadonlyMap<string, string> {
    this.cookieCache ??= parseCookieHeader(this.headers.get("cookie"));
    return this.cookieCache;
  }

  get queryString(): string {
    const text = this.query.toString();
    return text ? `?${text}` : "";
  }

  /** Port of `Request.IsAjax()`. */
  isAjax(): boolean {
    return this.headers.get("x-requested-with") === "XMLHttpRequest";
  }

  /** Port of `Request.CanAccept(contentType)`. */
  canAccept(contentType: string): boolean {
    const accept = this.headers.get("accept");
    return accept !== undefined && accept.toLowerCase().includes(contentType.toLowerCase());
  }

  /** Port of `Request.HasFormContentType`. */
  get hasFormContentType(): boolean {
    return (this.contentType ?? "").toLowerCase().startsWith(MimeTypes.Application.FormUrlEncoded);
  }

  get hasJsonContentType(): boolean {
    const type = (this.contentType ?? "").toLowerCase();
    return type.startsWith(MimeTypes.Application.Json) || /^application\/[a-z0-9.+-]*\+json/.test(type);
  }

  /** Parses a form-urlencoded body. */
  form(): URLSearchParams {
    return new URLSearchParams(this.hasFormContentType ? (this.body ?? "") : "");
  }

  /** Parses the JSON body with the request's serializer; `schema` (zod or a DTO with `static schema`) validates it. */
  json<T = unknown>(serializer: IJsonSerializer, schema?: JsonSchema<T>): T {
    const body = this.body ?? "";
    return schema ? serializer.deserialize(body, schema) : (serializer.deserialize(body) as T);
  }

  /** `scheme://host/path?query`. */
  get url(): string {
    return `${this.scheme}://${this.host ?? "localhost"}${this.rawPath}${this.queryString}`;
  }
}

function toSearchParams(query: AbpHttpRequestInit["query"]): URLSearchParams {
  if (query === undefined) return new URLSearchParams();
  if (query instanceof URLSearchParams) return query;
  if (typeof query === "string") return new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  return params;
}

function toBytes(body: string | Uint8Array | undefined, isBase64Encoded: boolean): Uint8Array | undefined {
  if (body === undefined) return undefined;
  if (typeof body !== "string") return body;
  return isBase64Encoded ? new Uint8Array(Buffer.from(body, "base64")) : new Uint8Array(Buffer.from(body, "utf8"));
}

/** Port of `HttpResponse` (buffered: Lambda returns the whole response at once). */
export class AbpHttpResponse {
  statusCode: number = HttpStatusCode.OK;
  readonly headers = new HttpHeaders();
  readonly cookies: string[] = [];
  private bodyValue: string | Uint8Array | undefined;
  private started = false;
  private readonly onStartingCallbacks: (() => void | Promise<void>)[] = [];

  get body(): string | Uint8Array | undefined {
    return this.bodyValue;
  }

  set body(value: string | Uint8Array | undefined) {
    this.bodyValue = value;
  }

  /** Port of `HasStarted`: true once a body has been written (headers/status can no longer change safely). */
  get hasStarted(): boolean {
    return this.started;
  }

  get contentType(): string | undefined {
    return this.headers.get("content-type");
  }

  set contentType(value: string | undefined) {
    if (value === undefined) this.headers.delete("content-type");
    else this.headers.set("content-type", value);
  }

  /** Port of `Response.OnStarting`: runs right before the first body write. */
  onStarting(callback: () => void | Promise<void>): void {
    this.onStartingCallbacks.push(callback);
  }

  /** Port of `Response.Clear()`. */
  clear(): void {
    if (this.started) throw new AbpException("The response has already started.");
    this.statusCode = HttpStatusCode.OK;
    for (const [name] of [...this.headers]) this.headers.delete(name);
    this.cookies.length = 0;
    this.bodyValue = undefined;
  }

  async write(body: string | Uint8Array, contentType?: string): Promise<void> {
    if (!this.started) {
      for (const callback of this.onStartingCallbacks) await callback();
      this.started = true;
    }
    if (contentType !== undefined && !this.headers.has("content-type")) this.headers.set("content-type", contentType);
    this.bodyValue = this.bodyValue === undefined || this.bodyValue === "" ? body : concat(this.bodyValue, body);
  }

  async json(value: unknown, serializer: IJsonSerializer, statusCode?: number): Promise<void> {
    if (statusCode !== undefined) this.statusCode = statusCode;
    this.headers.set("content-type", `${MimeTypes.Application.Json}; charset=utf-8`);
    await this.write(serializer.serialize(value));
  }

  async text(value: string, statusCode?: number, contentType = `${MimeTypes.Text.Plain}; charset=utf-8`): Promise<void> {
    if (statusCode !== undefined) this.statusCode = statusCode;
    this.headers.set("content-type", contentType);
    await this.write(value);
  }

  noContent(): void {
    this.statusCode = HttpStatusCode.NoContent;
    this.bodyValue = undefined;
  }

  redirect(location: string, permanent = false): void {
    this.statusCode = permanent ? HttpStatusCode.MovedPermanently : HttpStatusCode.Found;
    this.headers.set("location", location);
  }

  setCookie(name: string, value: string, options?: CookieOptions): void {
    this.cookies.push(serializeCookie(name, value, options));
  }

  deleteCookie(name: string, options?: CookieOptions): void {
    this.cookies.push(serializeCookie(name, "", { ...options, expires: new Date(0), maxAge: 0 }));
  }

  /** Body as text (binary bodies are decoded as UTF-8). */
  get bodyText(): string {
    if (this.bodyValue === undefined) return "";
    return typeof this.bodyValue === "string" ? this.bodyValue : Buffer.from(this.bodyValue).toString("utf8");
  }
}

function concat(a: string | Uint8Array, b: string | Uint8Array): string | Uint8Array {
  if (typeof a === "string" && typeof b === "string") return a + b;
  return new Uint8Array(Buffer.concat([Buffer.from(a), Buffer.from(b)]));
}

/**
 * Port of `IActionResult` for the object-result world: an action returns an `HttpResult` to control the status
 * code, headers and body instead of letting the endpoint serialize its return value.
 */
export class HttpResult {
  headers = new HttpHeaders();
  cookies: string[] = [];

  constructor(
    public statusCode: number,
    public body: unknown = undefined,
    public contentType: string | undefined = undefined,
  ) {}

  static ok(body?: unknown): HttpResult {
    return new HttpResult(HttpStatusCode.OK, body);
  }
  static created(location: string | undefined, body?: unknown): HttpResult {
    const result = new HttpResult(HttpStatusCode.Created, body);
    if (location) result.headers.set("location", location);
    return result;
  }
  static noContent(): HttpResult {
    return new HttpResult(HttpStatusCode.NoContent);
  }
  static json(body: unknown, statusCode: number = HttpStatusCode.OK): HttpResult {
    return new HttpResult(statusCode, body, MimeTypes.Application.Json);
  }
  static text(body: string, statusCode: number = HttpStatusCode.OK, contentType = MimeTypes.Text.Plain): HttpResult {
    return new HttpResult(statusCode, body, contentType);
  }
  static status(statusCode: number, body?: unknown): HttpResult {
    return new HttpResult(statusCode, body);
  }
  static redirect(location: string, permanent = false): HttpResult {
    const result = new HttpResult(permanent ? HttpStatusCode.MovedPermanently : HttpStatusCode.Found);
    result.headers.set("location", location);
    return result;
  }
  static file(content: Uint8Array | string, contentType = MimeTypes.Application.OctetStream, fileName?: string): HttpResult {
    const result = new HttpResult(HttpStatusCode.OK, content, contentType);
    if (fileName) result.headers.set("content-disposition", `attachment; filename="${fileName}"`);
    return result;
  }

  withHeader(name: string, value: string): this {
    this.headers.set(name, value);
    return this;
  }

  withCookie(name: string, value: string, options?: CookieOptions): this {
    this.cookies.push(serializeCookie(name, value, options));
    return this;
  }

  /** Writes this result to the response. */
  async apply(response: AbpHttpResponse, serializer: IJsonSerializer): Promise<void> {
    response.statusCode = this.statusCode;
    for (const [name, value] of this.headers) response.headers.set(name, value);
    response.cookies.push(...this.cookies);
    if (this.body === undefined || this.body === null) return;
    if (typeof this.body === "string" || this.body instanceof Uint8Array) {
      await response.write(this.body, this.contentType ?? (typeof this.body === "string" ? `${MimeTypes.Text.Plain}; charset=utf-8` : MimeTypes.Application.OctetStream));
      return;
    }
    await response.json(this.body, serializer);
  }
}

/** The endpoint selected by the routing middleware (port of `Endpoint` + `ControllerActionDescriptor`). */
export interface RouteEndpoint {
  readonly controllerType: Class;
  readonly actionName: string;
  readonly httpMethod: string;
  readonly routeTemplate: string;
  readonly routeValues: Readonly<Record<string, string>>;
  readonly metadata: ReadonlyMap<string, unknown>;
}

/** Port of `HttpContext`: one per request; `serviceProvider` is the request scope. */
export class AbpHttpContext {
  readonly request: AbpHttpRequest;
  readonly response = new AbpHttpResponse();
  readonly items = new Map<string, unknown>();
  user: ClaimsPrincipal = new ClaimsPrincipal(new ClaimsIdentity());
  correlationId: string | undefined;
  endpoint: RouteEndpoint | undefined;
  tenantResolveResult: TenantResolveResult | undefined;
  readonly abortSignal: AbortSignal;
  /** The raw host event (`APIGatewayProxyEventV2`, `IncomingMessage`, …) for escape hatches. */
  readonly hostEvent: unknown;

  constructor(
    request: AbpHttpRequest | AbpHttpRequestInit,
    readonly serviceProvider: IServiceProvider,
    options: { abortSignal?: AbortSignal; hostEvent?: unknown } = {},
  ) {
    this.request = request instanceof AbpHttpRequest ? request : new AbpHttpRequest(request);
    this.abortSignal = options.abortSignal ?? new AbortController().signal;
    this.hostEvent = options.hostEvent;
  }

  /** `RequestServices.GetRequiredService<T>()`. */
  getRequiredService<K extends Parameters<IServiceProvider["getRequired"]>[0]>(key: K): ReturnType<IServiceProvider["getRequired"]> {
    return this.serviceProvider.getRequired(key);
  }

  get jsonSerializer(): IJsonSerializer {
    return this.serviceProvider.getRequired(IJsonSerializer);
  }
}

/** Port of `IHttpContextAccessor`. The context is ambient (`AsyncLocalStorage`), so any service in the request flow can read it. */
export interface IHttpContextAccessor {
  readonly httpContext: AbpHttpContext | undefined;
  run<R>(httpContext: AbpHttpContext | undefined, fn: () => R): R;
}
export const IHttpContextAccessor = createToken<IHttpContextAccessor>("IHttpContextAccessor");

export const HttpContextAmbientKey = "Abp.AspNetCore.HttpContext";

@Singleton(IHttpContextAccessor)
export class HttpContextAccessor implements IHttpContextAccessor {
  static readonly inject = [IAmbientScopeProvider] as const;

  constructor(private readonly ambientScopeProvider: IAmbientScopeProvider<AbpHttpContext>) {}

  get httpContext(): AbpHttpContext | undefined {
    return this.ambientScopeProvider.getValue(HttpContextAmbientKey);
  }

  run<R>(httpContext: AbpHttpContext | undefined, fn: () => R): R {
    return this.ambientScopeProvider.run(HttpContextAmbientKey, httpContext, fn);
  }
}

/** Ambient key shared with `@abp/event-bus`'s `DefaultCorrelationIdProvider` (`Volo.Abp.Tracing`), which reads the same slot. */
export const CorrelationIdAmbientKey = "Abp.Tracing.CorrelationId";

export { AbpAmbientKeys };
