import { describe, expect, it } from "vitest";
import { AbpApplication, AbpException, AbpModule, BusinessException, CultureHelper, DependsOn, Transient, UserFriendlyException, type IHasHttpStatusCode, type ServiceConfigurationContext } from "@abp/core";
import { AbpDbConcurrencyException } from "@abp/data";
import { AbpExceptionLocalizationOptions, AbpLocalizationOptions, LocalizationResourceName } from "@abp/localization";
import { AbpAuthorizationException } from "@abp/security";
import { ICurrentTenant, IMultiTenantUrlProvider, type IMultiTenantUrlProvider as MultiTenantUrlProviderType } from "@abp/multi-tenancy-abstractions";
import { AbpValidationException, createValidationResult } from "@abp/validation";
import {
  AbpExceptionHandlingOptions,
  AbpExceptionHttpStatusCodeOptions,
  AbpHttpModule,
  AbpRemoteCallException,
  AbpRemoteServiceOptions,
  AbpRemoteServicesModule,
  HttpMethodHelper,
  HttpStatusCode,
  IExceptionToErrorInfoConverter,
  IHttpExceptionStatusCodeFinder,
  IRemoteServiceConfigurationProvider,
  NotImplementedException,
  RemoteServiceConfiguration,
  RemoteServiceErrorInfo,
} from "../src/index.js";

@LocalizationResourceName("TestResource")
class TestResource {}

class EntityNotFoundException extends AbpException {
  constructor(
    readonly entityType: string | undefined,
    readonly id: unknown,
  ) {
    super(id === undefined ? `There is no such an entity given id. Entity type: ${entityType}` : `There is no such an entity. Entity type: ${entityType}, id: ${id}`);
  }
}

@Transient(IMultiTenantUrlProvider)
class TestMultiTenantUrlProvider implements MultiTenantUrlProviderType {
  static readonly inject = [ICurrentTenant] as const;
  constructor(private readonly currentTenant: ICurrentTenant) {}
  async getUrl(templateUrl: string): Promise<string> {
    return templateUrl.replace("{0}.", this.currentTenant.name ? `${this.currentTenant.name}.` : "");
  }
}

@DependsOn(AbpHttpModule, AbpRemoteServicesModule)
class TestModule extends AbpModule {
  override configureServices(context: ServiceConfigurationContext): void {
    context.services.addType(TestMultiTenantUrlProvider);
    this.configure(AbpLocalizationOptions, (options) => {
      options.resources.add(TestResource, "en").addJson(
        { culture: "en", texts: { "MyApp:010001": "The book '{Name}' is out of stock (only {Count} left).", "MyApp:010002": "Plain localized" } },
        { culture: "tr", texts: { "MyApp:010001": "'{Name}' kitabı stokta yok ({Count} kaldı)." } },
      );
    });
    this.configure(AbpExceptionLocalizationOptions, (options) => {
      options.mapCodeNamespace("MyApp", TestResource);
    });
    this.configure(AbpExceptionHttpStatusCodeOptions, (options) => {
      options.map("MyApp:010002", HttpStatusCode.Conflict);
    });
  }
}

async function createApp(configure?: (options: AbpExceptionHandlingOptions) => void) {
  const app = await AbpApplication.create(TestModule, {
    configuration: { skipDefaults: true, values: { RemoteServices: { Default: { BaseUrl: "https://api.example.com/" }, Identity: { BaseUrl: "https://{0}.identity.example.com/", Version: "2" } } } },
  });
  if (configure) app.services.options.configure(AbpExceptionHandlingOptions, configure);
  await app.initialize();
  return app;
}

describe("DefaultExceptionToErrorInfoConverter", () => {
  it("passes user friendly messages through with details, code and data", async () => {
    const app = await createApp();
    const converter = app.serviceProvider.getRequired(IExceptionToErrorInfoConverter);
    const exception = new UserFriendlyException("You cannot do that", { code: "Custom:1", details: "Because" }).withData("Reason", "policy");

    const info = converter.convert(exception);
    expect(info.message).toBe("You cannot do that");
    expect(info.details).toBe("Because");
    expect(info.code).toBe("Custom:1");
    expect(info.data).toEqual({ Reason: "policy" });
    expect(info.validationErrors).toBeUndefined();
  });

  it("localizes business exception codes through the mapped resource and substitutes data placeholders", async () => {
    const app = await createApp();
    const converter = app.serviceProvider.getRequired(IExceptionToErrorInfoConverter);
    const exception = new BusinessException({ code: "MyApp:010001" }).withData("Name", "DDD").withData("Count", 0);

    const info = converter.convert(exception);
    expect(info.message).toBe("The book 'DDD' is out of stock (only 0 left).");
    expect(info.code).toBe("MyApp:010001");
    expect(info.data).toEqual({ Name: "DDD", Count: 0 });

    const turkish = CultureHelper.run("tr", () => converter.convert(exception));
    expect(turkish.message).toBe("'DDD' kitabı stokta yok (0 kaldı).");
  });

  it("does not localize codes of unmapped namespaces or without a namespace", async () => {
    const app = await createApp();
    const converter = app.serviceProvider.getRequired(IExceptionToErrorInfoConverter);
    expect(converter.convert(new BusinessException({ code: "Other:1", message: "fallback" })).message).toBe("An internal error occurred during your request!");
    expect(converter.convert(new UserFriendlyException("shown", { code: "NoNamespace" })).message).toBe("shown");
  });

  it("converts validation exceptions into validation error infos with camelCase members", async () => {
    const app = await createApp();
    const converter = app.serviceProvider.getRequired(IExceptionToErrorInfoConverter);
    const exception = new AbpValidationException([createValidationResult("Name is required", "Name"), createValidationResult("Age must be positive", "Age", "Person.Age")]);

    const info = converter.convert(exception);
    expect(info.message).toBe("Your request is not valid!");
    expect(info.details).toContain("The following errors were detected during validation.");
    expect(info.details).toContain(" - Name is required");
    expect(info.validationErrors).toEqual([
      { message: "Name is required", members: ["name"] },
      { message: "Age must be positive", members: ["age", "person.Age"] },
    ]);
  });

  it("recognises EntityNotFoundException by class name", async () => {
    const app = await createApp();
    const converter = app.serviceProvider.getRequired(IExceptionToErrorInfoConverter);
    expect(converter.convert(new EntityNotFoundException("Book", 42)).message).toBe("There is no entity Book with id = 42!");
    expect(converter.convert(new EntityNotFoundException("Book", undefined)).message).toBe("There is no entity Book!");
    expect(converter.convert(new EntityNotFoundException(undefined, undefined)).message).toBe("There is no such an entity given id. Entity type: undefined");
  });

  it("hides internal exceptions unless details are sent to clients", async () => {
    const app = await createApp();
    const converter = app.serviceProvider.getRequired(IExceptionToErrorInfoConverter);
    const error = new Error("db down", { cause: new Error("socket closed") });

    const hidden = converter.convert(error);
    expect(hidden.message).toBe("An internal error occurred during your request!");
    expect(hidden.details).toBeUndefined();
    expect(hidden.data).toBeUndefined();

    const detailed = converter.convert(error, (o) => {
      o.sendExceptionsDetailsToClients = true;
      o.sendStackTraceToClients = true;
    });
    expect(detailed.message).toBe("db down");
    expect(detailed.details).toContain("Error: db down");
    expect(detailed.details).toContain("STACK TRACE:");
    expect(detailed.details).toContain("Error: socket closed");

    const withoutStack = converter.convert(error, (o) => {
      o.sendExceptionsDetailsToClients = true;
      o.sendStackTraceToClients = false;
    });
    expect(withoutStack.details).not.toContain("STACK TRACE:");
  });

  it("honours the configured options as defaults", async () => {
    const app = await createApp((o) => {
      o.sendExceptionsDetailsToClients = true;
      o.sendStackTraceToClients = false;
    });
    const info = app.serviceProvider.getRequired(IExceptionToErrorInfoConverter).convert(new Error("boom"));
    expect(info.message).toBe("boom");
    expect(info.details).toBe("Error: boom");
  });

  it("unwraps aggregate errors, maps concurrency errors and authorization errors", async () => {
    const app = await createApp();
    const converter = app.serviceProvider.getRequired(IExceptionToErrorInfoConverter);

    const aggregate = new AggregateError([new UserFriendlyException("inner friendly")], "outer");
    expect(converter.convert(aggregate).message).toBe("inner friendly");
    expect(converter.convert(new AggregateError([new Error("x")], "outer")).message).toBe("An internal error occurred during your request!");

    expect(converter.convert(new AbpDbConcurrencyException("conflict")).message).toBe("The data you have submitted has already been changed by another user. Discard your changes and try again.");

    const unauthorized = converter.convert(new AbpAuthorizationException("Secret reason", "Volo.Authorization:010001"));
    expect(unauthorized.message).toBe("An internal error occurred during your request!");
    expect(unauthorized.code).toBe("Volo.Authorization:010001");
  });

  it("passes remote call errors through and localizes the well-known messages", async () => {
    const app = await createApp();
    const converter = app.serviceProvider.getRequired(IExceptionToErrorInfoConverter);
    const remote = new AbpRemoteCallException(new RemoteServiceErrorInfo("Unauthorized", "SessionExpired", "Remote:1"), { httpStatusCode: 401 });

    const info = converter.convert(remote);
    expect(info.message).toBe("Unauthorized");
    expect(info.details).toBe("Your session has expired. Please login again to continue in the application.");
    expect(info.code).toBe("Remote:1");
    expect(remote.code).toBe("Remote:1");
    expect(remote.httpStatusCode).toBe(401);
  });
});

describe("DefaultHttpExceptionStatusCodeFinder", () => {
  it("maps exceptions to status codes", async () => {
    const app = await createApp();
    const finder = app.serviceProvider.getRequired(IHttpExceptionStatusCodeFinder);
    const anonymous = { user: { isAuthenticated: false } };
    const authenticated = { user: { isAuthenticated: true } };

    expect(finder.getStatusCode(anonymous, new AbpAuthorizationException())).toBe(HttpStatusCode.Unauthorized);
    expect(finder.getStatusCode(authenticated, new AbpAuthorizationException())).toBe(HttpStatusCode.Forbidden);
    expect(finder.getStatusCode(anonymous, new AbpValidationException([]))).toBe(HttpStatusCode.BadRequest);
    expect(finder.getStatusCode(anonymous, new EntityNotFoundException("Book", 1))).toBe(HttpStatusCode.NotFound);
    expect(finder.getStatusCode(anonymous, new AbpDbConcurrencyException())).toBe(HttpStatusCode.Conflict);
    expect(finder.getStatusCode(anonymous, new NotImplementedException())).toBe(HttpStatusCode.NotImplemented);
    expect(finder.getStatusCode(anonymous, new BusinessException({ code: "X:1" }))).toBe(HttpStatusCode.Forbidden);
    expect(finder.getStatusCode(anonymous, new UserFriendlyException("x"))).toBe(HttpStatusCode.Forbidden);
    expect(finder.getStatusCode(anonymous, new Error("x"))).toBe(HttpStatusCode.InternalServerError);
    expect(finder.getStatusCode(undefined, new AbpAuthorizationException())).toBe(HttpStatusCode.Unauthorized);
  });

  it("prefers explicit status codes and error code mappings", async () => {
    const app = await createApp();
    const finder = app.serviceProvider.getRequired(IHttpExceptionStatusCodeFinder);
    const withStatus: Error & IHasHttpStatusCode = Object.assign(new Error("teapot"), { httpStatusCode: 418 });
    expect(finder.getStatusCode(undefined, withStatus)).toBe(418);
    expect(finder.getStatusCode(undefined, new BusinessException({ code: "MyApp:010002" }))).toBe(HttpStatusCode.Conflict);
    expect(finder.getStatusCode(undefined, new AbpRemoteCallException(new RemoteServiceErrorInfo("x"), { httpStatusCode: 502 }))).toBe(502);
  });
});

describe("remote services", () => {
  it("binds remote service configurations from configuration and applies tenant placeholders", async () => {
    const app = await createApp();
    const options = app.serviceProvider.getOptions(AbpRemoteServiceOptions);
    expect(options.remoteServices.default?.baseUrl).toBe("https://api.example.com/");
    expect(options.remoteServices.get("Identity")?.version).toBe("2");
    expect(options.remoteServices.getConfigurationOrDefault("Unknown").baseUrl).toBe("https://api.example.com/");

    const provider = app.serviceProvider.getRequired(IRemoteServiceConfigurationProvider);
    expect((await provider.getConfigurationOrDefault("Identity")).baseUrl).toBe("https://identity.example.com/");
    const acme = await app.serviceProvider.getRequired(ICurrentTenant).run("11111111-1111-4111-8111-111111111111", "acme", () => provider.getConfigurationOrDefault("Identity"));
    expect(acme.baseUrl).toBe("https://acme.identity.example.com/");
    expect(options.remoteServices.get("Identity")?.baseUrl).toBe("https://{0}.identity.example.com/");
    expect((await provider.getConfigurationOrDefault()).baseUrl).toBe("https://api.example.com/");
    expect(await provider.getConfigurationOrDefaultOrNull("Nope")).toBe(options.remoteServices.default);
  });

  it("copies configurations", () => {
    const original = new RemoteServiceConfiguration("https://a/", "1");
    const copy = new RemoteServiceConfiguration(original);
    copy.baseUrl = "https://b/";
    expect(original.baseUrl).toBe("https://a/");
    expect(copy.version).toBe("1");
  });
});

describe("HttpMethodHelper", () => {
  it("derives conventional verbs and strips prefixes", () => {
    expect(HttpMethodHelper.getConventionalVerbForMethodName("GetListAsync")).toBe("GET");
    expect(HttpMethodHelper.getConventionalVerbForMethodName("UpdateAsync")).toBe("PUT");
    expect(HttpMethodHelper.getConventionalVerbForMethodName("RemoveAsync")).toBe("DELETE");
    expect(HttpMethodHelper.getConventionalVerbForMethodName("Approve")).toBe("POST");
    expect(HttpMethodHelper.removeHttpMethodPrefix("GetListAsync", "GET")).toBe("Async");
    expect(HttpMethodHelper.removeHttpMethodPrefix("GetAsync", "GET")).toBe("Async");
    expect(HttpMethodHelper.removeHttpMethodPrefix("Approve", "POST")).toBe("Approve");
    expect(HttpMethodHelper.normalize("patch")).toBe("PATCH");
    expect(() => HttpMethodHelper.normalize("FETCH")).toThrow(AbpException);
    expect(HttpMethodHelper.isGet("get")).toBe(true);
  });
});
