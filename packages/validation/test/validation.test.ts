import { AbpApplication, AbpModule, DependsOn, LogLevel, LoggerBase, ServiceCollection, Transient, hasValidationErrors } from "@abp/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AbpValidationException,
  AbpValidationModule,
  AbpValidationOptions,
  DisableValidation,
  EnableValidation,
  IMethodInvocationValidator,
  IObjectValidator,
  MethodInvocationValidationContext,
  NumericValueValidator,
  RequiredParameters,
  StringValueValidator,
  ValidationEnabled,
  ValidationHelper,
  ValidationInterceptor,
  ZodObjectValidationContributor,
  createValidationResult,
  getValidationErrors,
  validateObject,
  withValidationError,
  type IValidatableObject,
  type ObjectValidationContext,
  type ValidationContext,
} from "../src/index.js";

class AuthorDto {
  static readonly schema = z.object({ name: z.string().min(2) });
  constructor(public name = "") {}
}

class CreateBookDto {
  static readonly schema = z.object({
    title: z.string().min(1, "Title is required"),
    price: z.number().nonnegative(),
    author: z.instanceof(AuthorDto).optional(),
    tags: z.array(z.string()).max(2).optional(),
  });
  title = "";
  price = 0;
  author: AuthorDto | undefined;
  tags: string[] | undefined;
  extra: unknown;
  @DisableValidation()
  ignored: unknown;
}

class SelfValidating implements IValidatableObject {
  constructor(public from = 1, public to = 0) {}
  async validate(context: ValidationContext) {
    expect(context.objectInstance).toBe(this);
    return this.from > this.to ? [createValidationResult("from must be <= to", "from", "to")] : [];
  }
}

function validBook(): CreateBookDto {
  const dto = new CreateBookDto();
  dto.title = "DDD";
  dto.price = 10;
  return dto;
}

describe("AbpValidationException", () => {
  it("carries validation errors, warning log level and self-logs", () => {
    const e = new AbpValidationException([createValidationResult("bad", "x")]);
    expect(hasValidationErrors(e)).toBe(true);
    expect(e.logLevel).toBe(LogLevel.Warning);
    expect(e.message).toMatch(/Validation failed/);
    withValidationError(e, "also bad", "y", "z");
    withValidationError(e, createValidationResult("third"));
    expect(e.validationErrors).toHaveLength(3);
    const logged: string[] = [];
    class CapturingLogger extends LoggerBase {
      constructor() {
        super("t", LogLevel.Trace);
      }
      write(_level: LogLevel, message: string): void {
        logged.push(message);
      }
    }
    e.log(new CapturingLogger());
    expect(logged[0]).toContain("There are 3 validation errors:");
    expect(logged[0]).toContain("also bad (y, z)");
    expect(new AbpValidationException("m", { cause: "c" }).cause).toBe("c");
    expect(new AbpValidationException("m", [createValidationResult("e")]).validationErrors).toHaveLength(1);
  });
});

describe("ZodObjectValidationContributor (validateObject)", () => {
  it("reports zod schema failures with member names and the [Required] message for missing values", async () => {
    const dto = new CreateBookDto();
    dto.price = -1;
    (dto as { title: unknown }).title = undefined;
    const errors = await getValidationErrors(dto);
    expect(errors).toEqual([
      { errorMessage: "The title field is required.", memberNames: ["title"] },
      { errorMessage: expect.stringContaining("Too small"), memberNames: ["price"] },
    ]);
    await expect(validateObject(dto)).rejects.toBeInstanceOf(AbpValidationException);
    await expect(validateObject(validBook())).resolves.toBeUndefined();
  });

  it("validates nested objects, arrays of objects and IValidatableObject recursively", async () => {
    const dto = validBook();
    dto.author = new AuthorDto("x");
    dto.extra = [new SelfValidating(2, 1), new SelfValidating(0, 1)];
    const errors = await getValidationErrors(dto);
    expect(errors).toEqual([
      { errorMessage: expect.stringContaining("Too small"), memberNames: ["name"] },
      { errorMessage: "from must be <= to", memberNames: ["from", "to"] },
    ]);
  });

  it("does not duplicate errors already reported by the parent schema", async () => {
    class Parent {
      static readonly schema = z.object({ child: AuthorDto.schema });
      child = new AuthorDto("x");
    }
    const errors = await getValidationErrors(new Parent());
    expect(errors).toEqual([{ errorMessage: expect.stringContaining("Too small"), memberNames: ["child.name"] }, { errorMessage: expect.stringContaining("Too small"), memberNames: ["name"] }]);
  });

  it("skips @DisableValidation() properties, ignored types and primitive arrays", async () => {
    const dto = validBook();
    dto.ignored = new AuthorDto("x");
    dto.tags = ["a"];
    expect(await getValidationErrors(dto)).toEqual([]);
    dto.extra = new AuthorDto("x");
    expect(await getValidationErrors(dto)).toHaveLength(1);
    expect(await getValidationErrors(dto, { configureOptions: (o) => o.ignoredTypes.push(CreateBookDto) })).toEqual([]);
  });

  it("stops at the maximum recursion depth", async () => {
    class Node implements IValidatableObject {
      child: Node | undefined;
      constructor(readonly depth: number) {}
      validate() {
        return [createValidationResult(`depth ${this.depth}`)];
      }
    }
    const root = new Node(1);
    let cursor = root;
    for (let i = 2; i <= 20; i++) {
      cursor.child = new Node(i);
      cursor = cursor.child;
    }
    expect(await getValidationErrors(root)).toHaveLength(ZodObjectValidationContributor.maxRecursiveParameterValidationDepth);
  });
});

@ValidationEnabled()
@Transient()
class BookAppService {
  calls: string[] = [];

  async create(input: CreateBookDto): Promise<string> {
    this.calls.push("create");
    return input?.title ?? "none";
  }

  @RequiredParameters(0)
  async createRequired(input: CreateBookDto | undefined, note?: string): Promise<string | undefined> {
    this.calls.push("createRequired");
    return note ?? input?.title;
  }

  @DisableValidation()
  async importUnchecked(input: CreateBookDto): Promise<string> {
    this.calls.push("importUnchecked");
    return input.title;
  }

  async noArgs(): Promise<string> {
    return "ok";
  }
}

@DisableValidation()
@Transient()
@ValidationEnabled()
class UncheckedAppService {
  async create(_input: CreateBookDto): Promise<boolean> {
    return true;
  }

  @EnableValidation()
  async createChecked(_input: CreateBookDto): Promise<boolean> {
    return true;
  }
}

class NotIntercepted {
  async create(input: CreateBookDto): Promise<string> {
    return input.title;
  }
}

class RecordingContributor {
  static seen: object[] = [];
  async addErrorsAsync(context: ObjectValidationContext): Promise<void> {
    RecordingContributor.seen.push(context.validatingObject);
  }
}

@DependsOn(AbpValidationModule)
class TestModule extends AbpModule {
  override configureServices(): void {
    this.context.services.addTransient(RecordingContributor);
    this.context.services.addTransient(NotIntercepted);
    this.configure(AbpValidationOptions, (o) => o.objectValidationContributors.add(RecordingContributor));
  }
}

describe("ValidationInterceptor through AbpValidationModule", () => {
  async function createApp() {
    const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true } });
    await app.initialize();
    return app;
  }

  it("intercepts @ValidationEnabled() classes only and blocks invalid arguments", async () => {
    const app = await createApp();
    expect(app.services.getInterceptors(BookAppService)).toEqual([ValidationInterceptor]);
    expect(app.services.getInterceptors(NotIntercepted)).toEqual([]);
    const service = app.serviceProvider.getRequired(BookAppService);
    await expect(service.create(validBook())).resolves.toBe("DDD");
    const invalid = new CreateBookDto();
    const error = await service.create(invalid).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AbpValidationException);
    expect((error as AbpValidationException).validationErrors).toEqual([{ errorMessage: "Title is required", memberNames: ["title"] }]);
    expect((error as AbpValidationException).message).toMatch(/Method arguments are not valid/);
    expect(service.calls).toEqual(["create"]);
    await expect(app.serviceProvider.getRequired(NotIntercepted).create(invalid)).resolves.toBe("");
    await expect(service.noArgs()).resolves.toBe("ok");
    await app.shutdown();
  });

  it("allows null arguments unless @RequiredParameters marks them", async () => {
    const app = await createApp();
    const service = app.serviceProvider.getRequired(BookAppService);
    await expect(service.create(undefined as unknown as CreateBookDto)).resolves.toBe("none");
    const error = await service.createRequired(undefined, "n").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AbpValidationException);
    expect((error as AbpValidationException).validationErrors).toEqual([{ errorMessage: "input is null!", memberNames: ["input"] }]);
    await expect(service.createRequired(validBook())).resolves.toBe("DDD");
    await app.shutdown();
  });

  it("respects @DisableValidation() on methods and classes and @EnableValidation()", async () => {
    const app = await createApp();
    const service = app.serviceProvider.getRequired(BookAppService);
    await expect(service.importUnchecked(new CreateBookDto())).resolves.toBe("");
    const unchecked = app.serviceProvider.getRequired(UncheckedAppService);
    await expect(unchecked.create(new CreateBookDto())).resolves.toBe(true);
    await expect(unchecked.createChecked(new CreateBookDto())).rejects.toBeInstanceOf(AbpValidationException);
    await app.shutdown();
  });

  it("runs every configured contributor from a scope and exposes IObjectValidator", async () => {
    const app = await createApp();
    RecordingContributor.seen = [];
    const validator = app.serviceProvider.getRequired(IObjectValidator);
    const book = validBook();
    await validator.validateAsync(book);
    expect(RecordingContributor.seen).toEqual([book]);
    await expect(validator.validateAsync(undefined, "input")).rejects.toMatchObject({ validationErrors: [{ errorMessage: "input is null!", memberNames: ["input"] }] });
    await expect(validator.getErrorsAsync(undefined)).resolves.toEqual([{ errorMessage: "Given object is null!", memberNames: [] }]);
    await expect(validator.getErrorsAsync(undefined, undefined, true)).resolves.toEqual([]);
    await expect(validator.getErrorsAsync(5)).resolves.toEqual([]);
    await app.shutdown();
  });

  it("does not validate twice when the concern is already applied (nested self-calls)", async () => {
    const app = await createApp();
    const validator = app.serviceProvider.getRequired(IMethodInvocationValidator);
    const target = new BookAppService();
    const context = new MethodInvocationValidationContext(target, BookAppService, "create", [new CreateBookDto()]);
    expect(context.parameters).toEqual([{ name: "input", index: 0, allowNull: true }]);
    await expect(validator.validateAsync(context)).rejects.toBeInstanceOf(AbpValidationException);
    const noParams = new MethodInvocationValidationContext(target, BookAppService, "noArgs", []);
    await expect(validator.validateAsync(noParams)).resolves.toBeUndefined();
    await app.shutdown();
  });
});

describe("ServiceCollection-level registration", () => {
  it("registers the interceptor only for marked classes even without the module", () => {
    const services = new ServiceCollection();
    services.onRegistered((ctx) => {
      if (ValidationEnabled.has(ctx.implementationType)) ctx.interceptors.tryAdd(ValidationInterceptor);
    });
    services.addConventionalRegistrations();
    expect(services.getInterceptors(BookAppService)).toEqual([ValidationInterceptor]);
  });
});

describe("string values and helpers", () => {
  it("value validators behave like ABP's", () => {
    expect(new NumericValueValidator(1, 10).isValid("5")).toBe(true);
    expect(new NumericValueValidator(1, 10).isValid(11)).toBe(false);
    expect(new NumericValueValidator().isValid("x")).toBe(false);
    const s = new StringValueValidator(2, 4, "^[a-z]+$");
    expect(s.isValid("abc")).toBe(true);
    expect(s.isValid("a")).toBe(false);
    expect(s.isValid("abcde")).toBe(false);
    expect(s.isValid("AB")).toBe(false);
    expect(s.isValid(null)).toBe(false);
    expect(new StringValueValidator(0, 0, undefined, true).isValid(null)).toBe(true);
    expect(s.properties.get("MinLength")).toBe(2);
    expect(ValidationHelper.isValidEmailAddress("a@b.co")).toBe(true);
    expect(ValidationHelper.isValidEmailAddress("nope")).toBe(false);
  });
});
