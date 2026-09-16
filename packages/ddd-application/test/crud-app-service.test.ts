import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AbpModule, DependsOn, NullLoggerFactory, Transient, type AbpApplicationCreationOptions, type ServiceCollection } from "@abp/core";
import { AbpAuthorizationException, AbpAuthorizationOptions, addAlwaysAllowAuthorization } from "@abp/authorization";
import { EntityNotFoundException, FullAuditedAggregateRoot, repositoryToken, type IRepository } from "@abp/ddd-domain";
import { AbpMemoryDbModule, MemoryDbContext, addMemoryDbContext } from "@abp/memory-db";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { AbpObjectMappingOptions, MappingProfile, mapProperties } from "@abp/object-mapping";
import { ObjectExtensionManager, mapExtraPropertiesTo } from "@abp/object-extending";
import { AbpClaimTypes, Claim, ClaimsIdentity, ClaimsPrincipal, ICurrentPrincipalAccessor } from "@abp/security";
import { AbpIntegratedTest } from "@abp/test-base";
import { AbpValidationException } from "@abp/validation";
import { z } from "zod";
import { AbpDddApplicationModule, ApplicationService, CrudAppService, ExtensibleEntityDto, FullAuditedEntityDto, IApplicationService, PagedAndSortedResultRequestDto, type ICrudAppService } from "../src/index.js";

class Book extends FullAuditedAggregateRoot<string> {
  title = "";
  price = 0;
  tenantId: string | undefined = undefined;
  constructor(id?: string, title = "", price = 0) {
    super(id);
    this.title = title;
    this.price = price;
  }
}

class BookDto extends FullAuditedEntityDto<string> {
  title = "";
  price = 0;
}
class ExtensibleBookDto extends ExtensibleEntityDto<string> {
  title = "";
}
class CreateBookDto {
  static readonly schema = z.object({ title: z.string().min(1), price: z.number().min(0) });
  title = "";
  price = 0;
}
class UpdateBookDto extends CreateBookDto {}

class BookProfile extends MappingProfile {
  constructor() {
    super();
    this.createMap(Book, BookDto, (book) => mapProperties(book, new BookDto()));
    this.createMap(Book, ExtensibleBookDto, (book) => {
      const dto = new ExtensibleBookDto();
      dto.id = book.id;
      dto.title = book.title;
      mapExtraPropertiesTo(book, dto);
      return dto;
    });
    this.createMap(CreateBookDto, Book, (input) => new Book(undefined, input.title, input.price));
    this.createMapTo(UpdateBookDto, Book, (input, book) => {
      book.title = input.title;
      book.price = input.price;
    });
  }
}

class BookStoreDbContext extends MemoryDbContext {
  override readonly entities = [Book];
}

@Transient()
class BookAppService extends CrudAppService<Book, BookDto, string, PagedAndSortedResultRequestDto, CreateBookDto, UpdateBookDto> implements ICrudAppService<BookDto, string, PagedAndSortedResultRequestDto, CreateBookDto, UpdateBookDto> {
  static readonly inject = [repositoryToken(Book)] as const;
  constructor(repository: IRepository<Book, string>) {
    super(repository, { entity: Book, getOutputDto: BookDto, createInput: CreateBookDto, updateInput: UpdateBookDto });
    this.createPolicyName = "Books.Create";
    this.deletePolicyName = "Books.Delete";
  }
}

@Transient()
class ExtensibleBookAppService extends CrudAppService<Book, ExtensibleBookDto, string> {
  static readonly inject = [repositoryToken(Book)] as const;
  constructor(repository: IRepository<Book, string>) {
    super(repository, { entity: Book, getOutputDto: ExtensibleBookDto });
  }
}

@Transient()
class HelperAppService extends ApplicationService {
  async whoAmI(): Promise<{ user: string | undefined; tenant: string | undefined; localized: string; uow: boolean }> {
    return { user: this.currentUser.id, tenant: this.currentTenant.id, localized: this.L.t("Hello"), uow: this.currentUnitOfWork !== undefined };
  }
}

@DependsOn(AbpDddApplicationModule, AbpMemoryDbModule)
class TestModule extends AbpModule {
  override configureServices(): void {
    addMemoryDbContext(this.context.services, BookStoreDbContext, (options) => options.addDefaultRepositories());
    this.configure(AbpObjectMappingOptions, (options) => {
      options.addProfile(BookProfile);
    });
    this.configure(AbpAuthorizationOptions, (options) => {
      options.addPolicy("Books.Create", (context) => context.user.isInRole("admin"));
      options.addPolicy("Books.Delete", (context) => context.user.isInRole("admin"));
    });
  }
}

ObjectExtensionManager.instance.addOrUpdateProperty([Book, ExtensibleBookDto], "string", "Color");

const userId = "0b7c9d1e-3f4a-4b5c-8d6e-7f8091a2b3c4";
const tenantA = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const admin = new ClaimsPrincipal(new ClaimsIdentity([new Claim(AbpClaimTypes.userId, userId), new Claim(AbpClaimTypes.role, "admin")], "Test"));

class AllowAllTest extends AbpIntegratedTest<typeof TestModule> {
  constructor() {
    super(TestModule);
  }
  protected override setAbpApplicationCreationOptions(options: AbpApplicationCreationOptions): void {
    options.loggerFactory = NullLoggerFactory.instance;
  }
  protected override afterAddApplication(services: ServiceCollection): void {
    addAlwaysAllowAuthorization(services);
  }
}

class EnforcingTest extends AbpIntegratedTest<typeof TestModule> {
  constructor() {
    super(TestModule);
  }
  protected override setAbpApplicationCreationOptions(options: AbpApplicationCreationOptions): void {
    options.loggerFactory = NullLoggerFactory.instance;
  }
}

describe("CrudAppService with AlwaysAllow authorization", () => {
  const test = new AllowAllTest();
  beforeAll(() => test.initialize());
  afterAll(() => test.dispose());

  it("creates, reads, updates and deletes through the repository and object mapper", async () => {
    const appService = test.getRequiredService(BookAppService);
    const created = await appService.create(Object.assign(new CreateBookDto(), { title: "DDD", price: 40 }));
    expect(created).toBeInstanceOf(BookDto);
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.title).toBe("DDD");
    expect(created.creationTime).toBeInstanceOf(Date);

    const loaded = await appService.get(created.id);
    expect(loaded).toMatchObject({ id: created.id, title: "DDD", price: 40 });

    const updated = await appService.update(created.id, Object.assign(new UpdateBookDto(), { title: "DDD 2nd", price: 45 }));
    expect(updated).toMatchObject({ id: created.id, title: "DDD 2nd", price: 45 });
    expect(updated.lastModificationTime).toBeInstanceOf(Date);

    await appService.delete(created.id);
    await expect(appService.get(created.id)).rejects.toBeInstanceOf(EntityNotFoundException);
    await expect(appService.update(created.id, Object.assign(new UpdateBookDto(), { title: "gone", price: 1 }))).rejects.toBeInstanceOf(EntityNotFoundException);
    await expect(appService.update(created.id, new UpdateBookDto())).rejects.toBeInstanceOf(AbpValidationException);
  });

  it("lists with paging, guarded sorting and default sorting", async () => {
    const appService = test.getRequiredService(BookAppService);
    const repository = test.getRequiredService(repositoryToken(Book));
    for (const [title, price, day] of [["A", 3, 1], ["B", 1, 2], ["C", 2, 3]] as const) {
      const book = new Book(undefined, title, price);
      book.creationTime = new Date(2024, 0, day);
      await repository.insert(book);
    }

    const byTitle = await appService.getList(Object.assign(new PagedAndSortedResultRequestDto(), { sorting: "title", maxResultCount: 2 }));
    expect(byTitle.totalCount).toBe(3);
    expect(byTitle.items.map((b) => b.title)).toEqual(["A", "B"]);
    expect(byTitle.items[0]).toBeInstanceOf(BookDto);

    const page2 = await appService.getList(Object.assign(new PagedAndSortedResultRequestDto(), { sorting: "Price DESC", skipCount: 1, maxResultCount: 5 }));
    expect(page2.items.map((b) => b.title)).toEqual(["C", "B"]);

    const defaultSorted = await appService.getList(new PagedAndSortedResultRequestDto());
    expect(defaultSorted.items.map((b) => b.title)).toEqual(["C", "B", "A"]);

    await expect(appService.getList(Object.assign(new PagedAndSortedResultRequestDto(), { sorting: "toString()" }))).rejects.toThrow(AbpValidationException);
    await expect(appService.getList(Object.assign(new PagedAndSortedResultRequestDto(), { sorting: "publisher" }))).rejects.toThrow("Sorting expression is not supported.");
  });

  it("validates inputs through the validation interceptor with the localized limit message", async () => {
    const appService = test.getRequiredService(BookAppService);
    await expect(appService.create(new CreateBookDto())).rejects.toBeInstanceOf(AbpValidationException);
    const tooMany = Object.assign(new PagedAndSortedResultRequestDto(), { maxResultCount: 5000 });
    const error = await appService.getList(tooMany).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AbpValidationException);
    expect((error as AbpValidationException).validationErrors[0]!.errorMessage).toBe("maxResultCount can not be more than 1000! Increase LimitedResultRequestDto.maxMaxResultCount on the server side to allow more results.");
  });

  it("sets the tenant of created entities and scopes reads to it", async () => {
    const appService = test.getRequiredService(BookAppService);
    const currentTenant = test.getRequiredService(ICurrentTenant);
    const tenantBook = await currentTenant.run(tenantA, undefined, () => appService.create(Object.assign(new CreateBookDto(), { title: "Tenant", price: 1 })));
    expect((await test.getRequiredService(repositoryToken(Book)).find(tenantBook.id))).toBeUndefined();
    const inTenant = await currentTenant.run(tenantA, undefined, () => appService.getList(new PagedAndSortedResultRequestDto()));
    expect(inTenant.items.map((b) => b.title)).toEqual(["Tenant"]);
  });

  it("maps extra properties of extensible DTOs", async () => {
    const repository = test.getRequiredService(repositoryToken(Book));
    const book = new Book(undefined, "Colorful", 9);
    book.extraProperties.set("Color", "red");
    await repository.insert(book);

    const appService = test.getRequiredService(ExtensibleBookAppService);
    const dto = await appService.get(book.id);
    expect(dto).toBeInstanceOf(ExtensibleBookDto);
    expect(dto.extraProperties.get("Color")).toBe("red");
  });

  it("exposes the ABP services to application services", async () => {
    const helper = test.getRequiredService(HelperAppService);
    expect(IApplicationService.has(HelperAppService)).toBe(true);
    const principal = test.getRequiredService(ICurrentPrincipalAccessor);
    const result = await principal.run(admin, () => helper.whoAmI());
    expect(result).toEqual({ user: userId, tenant: undefined, localized: "Hello", uow: true });
    expect(ApplicationService.commonPostfixes).toEqual(["AppService", "ApplicationService", "Service"]);
  });
});

describe("CrudAppService with enforced policies", () => {
  const test = new EnforcingTest();
  beforeAll(() => test.initialize());
  afterAll(() => test.dispose());

  it("allows unguarded methods but checks create/delete policies for the current principal", async () => {
    const appService = test.getRequiredService(BookAppService);
    const principal = test.getRequiredService(ICurrentPrincipalAccessor);

    expect((await appService.getList(new PagedAndSortedResultRequestDto())).totalCount).toBe(0);
    await expect(appService.create(Object.assign(new CreateBookDto(), { title: "Denied", price: 1 }))).rejects.toBeInstanceOf(AbpAuthorizationException);

    const created = await principal.run(admin, () => appService.create(Object.assign(new CreateBookDto(), { title: "Allowed", price: 1 })));
    expect(created.creatorId).toBe(userId);
    await expect(appService.delete(created.id)).rejects.toBeInstanceOf(AbpAuthorizationException);
    await principal.run(admin, () => appService.delete(created.id));
    expect((await appService.getList(new PagedAndSortedResultRequestDto())).totalCount).toBe(0);
  });
});
