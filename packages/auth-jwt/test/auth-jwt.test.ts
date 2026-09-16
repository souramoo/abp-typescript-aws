import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AbpApplication, AbpException, AbpModule, DependsOn, NullLoggerFactory, Transient, type ServiceConfigurationContext } from "@abp/core";
import { AbpHttpHost, Controller, HttpGet } from "@abp/aws-lambda";
import { AbpClaimTypes, Claim, ICurrentUser } from "@abp/security";
import { SignJWT, decodeJwt, exportJWK, exportPKCS8, exportSPKI, generateKeyPair } from "jose";
import {
  AbpAspNetCoreAuthenticationJwtBearerModule,
  AbpJwtBearerOptions,
  AbpJwtClientOptions,
  DistributedCacheRefreshTokenStore,
  IJwtTokenIssuer,
  IResourceOwnerPasswordValidator,
  IRefreshTokenStore,
  ISigningKeyProvider,
  InMemoryRefreshTokenStore,
  hashClientSecret,
  type IResourceOwnerPasswordValidator as PasswordValidator,
  type ResourceOwnerPasswordValidationResult,
} from "../src/index.js";

const secret = "0123456789abcdef0123456789abcdef-very-long-secret";
const userId = "44444444-4444-4444-8444-444444444444";

@Transient()
@Controller("api/test")
class TestController {
  static readonly inject = [ICurrentUser] as const;
  constructor(private readonly currentUser: ICurrentUser) {}

  @HttpGet("me")
  async me() {
    return { isAuthenticated: this.currentUser.isAuthenticated, id: this.currentUser.id, userName: this.currentUser.userName, roles: this.currentUser.roles, email: this.currentUser.email };
  }
}

class FakePasswordValidator implements PasswordValidator {
  async validate(userName: string, password: string): Promise<ResourceOwnerPasswordValidationResult> {
    if (userName === "admin" && password === "1q2w3E*") {
      return { kind: "success", claims: [new Claim(AbpClaimTypes.userId, userId), new Claim(AbpClaimTypes.userName, "admin"), new Claim(AbpClaimTypes.email, "admin@abp.io"), new Claim(AbpClaimTypes.role, "admin")] };
    }
    if (userName === "locked") return { kind: "error", error: "account_locked", errorDescription: "The user account has been locked out due to invalid login attempts." };
    return { kind: "error", error: "invalid_grant", errorDescription: "Invalid username or password!" };
  }
}

function defineModule(configure: (options: AbpJwtBearerOptions) => void, registerValidator = true) {
  @DependsOn(AbpAspNetCoreAuthenticationJwtBearerModule)
  class TestModule extends AbpModule {
    override configureServices(context: ServiceConfigurationContext): void {
      context.services.addType(TestController);
      if (registerValidator) context.services.addTransient(IResourceOwnerPasswordValidator, FakePasswordValidator);
      this.configure(AbpJwtBearerOptions, configure);
      this.configure(AbpJwtClientOptions, (options) => {
        options.addClient("backend", "backend-secret", { displayName: "Backend", scopes: ["api"] });
        options.addClient("mobile", undefined, { allowedGrantTypes: ["password", "refresh_token"] });
      });
    }
  }
  return TestModule;
}

async function createHost(configure: (options: AbpJwtBearerOptions) => void, values: Record<string, unknown> = {}, registerValidator = true) {
  const app = await AbpApplication.create(defineModule(configure, registerValidator), { loggerFactory: NullLoggerFactory.instance, configuration: { skipDefaults: true, values } });
  return AbpHttpHost.create(app);
}

function form(values: Record<string, string>): { headers: Record<string, string>; body: string } {
  return { headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values).toString() };
}

function json(response: { bodyText: string }): Record<string, unknown> {
  return JSON.parse(response.bodyText) as Record<string, unknown>;
}

describe("HMAC issuing and verification", () => {
  let host: AbpHttpHost;
  beforeAll(async () => {
    host = await createHost((o) => {
      o.signing = { kind: "hmac", secret };
      o.issuer = "https://auth.example.com";
      o.audience = "test-api";
      o.accessTokenLifetimeSeconds = 120;
    });
  });
  afterAll(() => host.dispose());

  it("issues a token the bearer handler accepts and maps to ICurrentUser", async () => {
    const issuer = host.application.serviceProvider.getRequired(IJwtTokenIssuer);
    const tokens = await issuer.issue([new Claim(AbpClaimTypes.userId, userId), new Claim(AbpClaimTypes.userName, "john"), new Claim(AbpClaimTypes.role, "admin"), new Claim(AbpClaimTypes.role, "editor")], { scopes: ["api"] });
    expect(tokens.tokenType).toBe("Bearer");
    expect(tokens.expiresIn).toBe(120);
    expect(tokens.refreshToken).toBeDefined();
    const payload = decodeJwt(tokens.accessToken);
    expect(payload).toMatchObject({ sub: userId, preferred_username: "john", role: ["admin", "editor"], iss: "https://auth.example.com", aud: "test-api", scope: "api" });
    expect(payload.exp! - payload.iat!).toBe(120);

    const me = await host.handle({ method: "GET", path: "/api/test/me", headers: { authorization: `Bearer ${tokens.accessToken}` } });
    expect(json(me)).toEqual({ isAuthenticated: true, id: userId, userName: "john", roles: ["admin", "editor"] });
  });

  it("rejects expired, tampered and foreign tokens with a WWW-Authenticate challenge", async () => {
    const key = new TextEncoder().encode(secret);
    const now = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({ sub: userId }).setProtectedHeader({ alg: "HS256" }).setIssuer("https://auth.example.com").setAudience("test-api").setIssuedAt(now - 1000).setExpirationTime(now - 500).sign(key);
    const response = await host.handle({ method: "GET", path: "/api/test/me", headers: { authorization: `Bearer ${expired}` } });
    expect(json(response)["isAuthenticated"]).toBe(false);

    const wrongIssuer = await new SignJWT({ sub: userId }).setProtectedHeader({ alg: "HS256" }).setIssuer("https://other").setAudience("test-api").setIssuedAt().setExpirationTime("1h").sign(key);
    expect(json(await host.handle({ method: "GET", path: "/api/test/me", headers: { authorization: `Bearer ${wrongIssuer}` } }))["isAuthenticated"]).toBe(false);

    const tampered = (await host.application.serviceProvider.getRequired(IJwtTokenIssuer).issue([new Claim(AbpClaimTypes.userId, userId)])).accessToken.slice(0, -4) + "AAAA";
    expect(json(await host.handle({ method: "GET", path: "/api/test/me", headers: { authorization: `Bearer ${tampered}` } }))["isAuthenticated"]).toBe(false);
  });

  it("serves openid-configuration and an empty JWKS for HMAC keys", async () => {
    const configuration = json(await host.handle({ method: "GET", path: "/.well-known/openid-configuration", host: "auth.example.com" }));
    expect(configuration["token_endpoint"]).toBe("https://auth.example.com/connect/token");
    expect(configuration["jwks_uri"]).toBe("https://auth.example.com/.well-known/jwks.json");
    expect(json(await host.handle({ method: "GET", path: "/.well-known/jwks.json" }))).toEqual({ keys: [] });
  });
});

describe("token endpoint", () => {
  let host: AbpHttpHost;
  beforeAll(async () => {
    host = await createHost((o) => {
      o.signing = { kind: "hmac", secret };
    });
  });
  afterAll(() => host.dispose());

  it("issues tokens for the password grant through the pipeline", async () => {
    const response = await host.handle({ method: "POST", path: "/connect/token", ...form({ grant_type: "password", username: "admin", password: "1q2w3E*", scope: "api offline_access" }) });
    expect(response.statusCode).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = json(response) as { access_token: string; token_type: string; expires_in: number; refresh_token: string; scope: string };
    expect(body.token_type).toBe("Bearer");
    expect(body.scope).toBe("api offline_access");
    expect(body.refresh_token).toBeDefined();

    const me = await host.handle({ method: "GET", path: "/api/test/me", headers: { authorization: `Bearer ${body.access_token}` } });
    expect(json(me)).toEqual({ isAuthenticated: true, id: userId, userName: "admin", roles: ["admin"], email: "admin@abp.io" });
  });

  it("accepts JSON token requests and reports OAuth errors", async () => {
    const bad = await host.handle({ method: "POST", path: "/connect/token", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant_type: "password", username: "admin", password: "wrong" }) });
    expect(bad.statusCode).toBe(400);
    expect(json(bad)).toEqual({ error: "invalid_grant", error_description: "Invalid username or password!" });

    const locked = await host.handle({ method: "POST", path: "/connect/token", ...form({ grant_type: "password", username: "locked", password: "x" }) });
    expect(json(locked)["error"]).toBe("account_locked");

    const unsupported = await host.handle({ method: "POST", path: "/connect/token", ...form({ grant_type: "device_code" }) });
    expect(json(unsupported)["error"]).toBe("unsupported_grant_type");

    const missing = await host.handle({ method: "POST", path: "/connect/token", ...form({}) });
    expect(json(missing)["error"]).toBe("invalid_request");
  });

  it("rotates refresh tokens and revokes them", async () => {
    const first = json(await host.handle({ method: "POST", path: "/connect/token", ...form({ grant_type: "password", username: "admin", password: "1q2w3E*" }) })) as { refresh_token: string };
    const refreshed = await host.handle({ method: "POST", path: "/connect/token", ...form({ grant_type: "refresh_token", refresh_token: first.refresh_token }) });
    expect(refreshed.statusCode).toBe(200);
    const second = json(refreshed) as { access_token: string; refresh_token: string };
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(decodeJwt(second.access_token)["sub"]).toBe(userId);

    const reused = await host.handle({ method: "POST", path: "/connect/token", ...form({ grant_type: "refresh_token", refresh_token: first.refresh_token }) });
    expect(reused.statusCode).toBe(400);
    expect(json(reused)["error"]).toBe("invalid_grant");

    const revoked = await host.handle({ method: "POST", path: "/connect/revocation", ...form({ token: second.refresh_token }) });
    expect(revoked.statusCode).toBe(200);
    expect(json(await host.handle({ method: "POST", path: "/connect/token", ...form({ grant_type: "refresh_token", refresh_token: second.refresh_token }) }))["error"]).toBe("invalid_grant");
  });

  it("supports client credentials with hashed secrets and Basic authentication", async () => {
    const ok = await host.handle({ method: "POST", path: "/connect/token", ...form({ grant_type: "client_credentials", client_id: "backend", client_secret: "backend-secret", scope: "api" }) });
    expect(ok.statusCode).toBe(200);
    const body = json(ok) as { access_token: string; refresh_token?: string };
    expect(body.refresh_token).toBeUndefined();
    expect(decodeJwt(body.access_token)).toMatchObject({ sub: "backend", client_id: "backend", preferred_username: "Backend" });

    const basic = await host.handle({ method: "POST", path: "/connect/token", headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from("backend:backend-secret").toString("base64")}` }, body: "grant_type=client_credentials" });
    expect(basic.statusCode).toBe(200);

    const wrongSecret = await host.handle({ method: "POST", path: "/connect/token", ...form({ grant_type: "client_credentials", client_id: "backend", client_secret: "nope" }) });
    expect(wrongSecret.statusCode).toBe(401);
    expect(json(wrongSecret)["error"]).toBe("invalid_client");

    const publicClient = await host.handle({ method: "POST", path: "/connect/token", ...form({ grant_type: "client_credentials", client_id: "mobile" }) });
    expect(json(publicClient)["error"]).toBe("unauthorized_client");
    expect(hashClientSecret("x")).toHaveLength(64);
  });

  it("answers unsupported_grant_type for the password grant when no validator is registered", async () => {
    const bare = await createHost((o) => {
      o.signing = { kind: "hmac", secret };
    }, {}, false);
    try {
      const response = await bare.handle({ method: "POST", path: "/connect/token", ...form({ grant_type: "password", username: "admin", password: "1q2w3E*" }) });
      expect(json(response)["error"]).toBe("unsupported_grant_type");
    } finally {
      await bare.dispose();
    }
  });
});

describe("RSA and JWKS", () => {
  it("issues RS256 tokens, publishes the JWKS and verifies with the public key only", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const privateKeyPem = await exportPKCS8(privateKey);
    const publicKeyPem = await exportSPKI(publicKey);

    const issuerHost = await createHost((o) => {
      o.signing = { kind: "rsa", privateKeyPem };
      o.issuer = "https://auth.example.com";
    });
    const tokens = await issuerHost.application.serviceProvider.getRequired(IJwtTokenIssuer).issue([new Claim(AbpClaimTypes.userId, userId), new Claim(AbpClaimTypes.userName, "rsa-user")]);
    const jwks = json(await issuerHost.handle({ method: "GET", path: "/.well-known/jwks.json" })) as { keys: { kid: string; kty: string; alg: string; use: string }[] };
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({ kty: "RSA", alg: "RS256", use: "sig" });
    await issuerHost.dispose();

    const verifierHost = await createHost((o) => {
      o.signing = { kind: "rsa", publicKeyPem };
      o.issuer = "https://auth.example.com";
    });
    const me = await verifierHost.handle({ method: "GET", path: "/api/test/me", headers: { authorization: `Bearer ${tokens.accessToken}` } });
    expect(json(me)).toMatchObject({ isAuthenticated: true, userName: "rsa-user" });
    await expect(verifierHost.application.serviceProvider.getRequired(IJwtTokenIssuer).issue([])).rejects.toThrow(AbpException);
    await verifierHost.dispose();
  });

  it("validates Cognito-style tokens from a JWKS and maps cognito:groups to roles", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const jwk = { ...(await exportJWK(publicKey)), kid: "cognito-key", alg: "RS256", use: "sig" };
    const cognitoHost = await createHost((o) => {
      o.signing = { kind: "jwks", jwks: { keys: [jwk] } };
      o.issuer = "https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_abc";
    });
    const token = await new SignJWT({ sub: userId, "cognito:username": "cognito-user", "cognito:groups": ["admins", "readers"], email: "u@example.com", token_use: "access" })
      .setProtectedHeader({ alg: "RS256", kid: "cognito-key" })
      .setIssuer("https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_abc")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
    const me = await cognitoHost.handle({ method: "GET", path: "/api/test/me", headers: { authorization: `Bearer ${token}` } });
    expect(json(me)).toEqual({ isAuthenticated: true, id: userId, userName: "cognito-user", roles: ["admins", "readers"], email: "u@example.com" });
    await expect(cognitoHost.application.serviceProvider.getRequired(IJwtTokenIssuer).issue([])).rejects.toThrow(AbpException);
    await cognitoHost.dispose();
  });
});

describe("configuration binding and stores", () => {
  it("reads the signing key and issuer from configuration and selects the distributed cache store", async () => {
    const host = await createHost(() => {}, { Abp: { Auth: { Jwt: { SigningKey: secret, Issuer: "https://cfg", AccessTokenLifetimeSeconds: 42, RefreshTokenStore: "distributed-cache" } } } });
    try {
      const options = host.application.serviceProvider.getOptions(AbpJwtBearerOptions);
      expect(options.issuer).toBe("https://cfg");
      expect(options.accessTokenLifetimeSeconds).toBe(42);
      expect(host.application.serviceProvider.getRequired(IRefreshTokenStore)).toBeInstanceOf(DistributedCacheRefreshTokenStore);
      const key = await host.application.serviceProvider.getRequired(ISigningKeyProvider).getSigningKey();
      expect(key.kind).toBe("hmac");

      const issuer = host.application.serviceProvider.getRequired(IJwtTokenIssuer);
      const tokens = await issuer.issue([new Claim(AbpClaimTypes.userId, userId)]);
      const refreshed = await issuer.refresh(tokens.refreshToken!);
      expect(refreshed.kind).toBe("success");
      expect((await issuer.refresh(tokens.refreshToken!)).kind).toBe("invalid");
    } finally {
      await host.dispose();
    }
  });

  it("fails clearly when no signing key is configured", async () => {
    const host = await createHost(() => {});
    try {
      await expect(host.application.serviceProvider.getRequired(ISigningKeyProvider).getSigningKey()).rejects.toThrow(/No JWT signing key/);
      expect(host.application.serviceProvider.getRequired(IRefreshTokenStore)).toBeInstanceOf(InMemoryRefreshTokenStore);
      const me = await host.handle({ method: "GET", path: "/api/test/me", headers: { authorization: "Bearer whatever" } });
      expect(json(me)["isAuthenticated"]).toBe(false);
    } finally {
      await host.dispose();
    }
  });
});
