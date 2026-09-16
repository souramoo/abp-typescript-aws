import type { IAbpApplication } from "@abp/core";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { AbpHttpRequest, HttpHeaders } from "../http-context.js";
import { cachedHost, type AbpHttpHost, type AbpHttpHostOptions } from "./abp-http-host.js";

export interface LocalServerOptions extends AbpHttpHostOptions {
  /** 0 picks a free port. Default: 3000. */
  port?: number;
  host?: string;
}

export interface LocalServer {
  readonly server: Server;
  start(): Promise<{ port: number; url: string }>;
  stop(): Promise<void>;
  /** The ABP host once started (useful in tests). */
  getHost(): Promise<AbpHttpHost>;
}

function readBody(message: IncomingMessage): Promise<Uint8Array | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    message.on("data", (chunk: Buffer) => chunks.push(chunk));
    message.on("end", () => resolve(chunks.length === 0 ? undefined : new Uint8Array(Buffer.concat(chunks))));
    message.on("error", reject);
  });
}

/** Converts a node `IncomingMessage` into an `AbpHttpRequest`. */
export async function toAbpHttpRequestFromNode(message: IncomingMessage): Promise<AbpHttpRequest> {
  const url = new URL(message.url ?? "/", "http://localhost");
  const headers = new HttpHeaders();
  for (const [name, value] of Object.entries(message.headers)) {
    if (value !== undefined) headers.append(name, value);
  }
  return new AbpHttpRequest({
    method: message.method ?? "GET",
    path: url.pathname,
    query: url.searchParams,
    headers,
    body: await readBody(message),
    ip: message.socket.remoteAddress,
    scheme: "http",
  });
}

/** `pnpm dev`: serves the same pipeline over `node:http` for local development. */
export function createLocalServer(appFactory: () => Promise<IAbpApplication>, options: LocalServerOptions = {}): LocalServer {
  const getHost = cachedHost(appFactory, options);
  const server = createServer(async (message: IncomingMessage, reply: ServerResponse) => {
    try {
      const host = await getHost();
      const controller = new AbortController();
      message.on("close", () => controller.abort());
      const response = await host.handle(await toAbpHttpRequestFromNode(message), { abortSignal: controller.signal, hostEvent: message });
      for (const [name, value] of response.headers) reply.setHeader(name, value);
      if (response.cookies.length > 0) reply.setHeader("set-cookie", response.cookies);
      reply.statusCode = response.statusCode;
      reply.end(response.body === undefined ? undefined : typeof response.body === "string" ? response.body : Buffer.from(response.body));
    } catch (e) {
      reply.statusCode = 500;
      reply.setHeader("content-type", "text/plain; charset=utf-8");
      reply.end(e instanceof Error ? e.stack ?? e.message : String(e));
    }
  });

  return {
    server,
    getHost,
    start: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port ?? 3000, options.host ?? "127.0.0.1", () => {
          const address = server.address() as AddressInfo;
          resolve({ port: address.port, url: `http://${options.host ?? "127.0.0.1"}:${address.port}` });
        });
      }),
    stop: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections?.();
      }),
  };
}
