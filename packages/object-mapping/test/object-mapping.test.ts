import { describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, ServiceCollection, type ServiceConfigurationContext } from "@abp/core";
import {
  AbpObjectMappingModule,
  AbpObjectMappingOptions,
  DefaultObjectMapper,
  IAutoObjectMappingProvider,
  type IMapFrom,
  type IMapTo,
  IObjectMapper,
  type ISpecificObjectMapper,
  MappingProfile,
  MappingRegistry,
  NotImplementedAutoObjectMappingProvider,
  ProfileAutoObjectMappingProvider,
  mapProperties,
  objectMapperToken,
  specificObjectMapperToken,
} from "../src/index.js";

class Author {
  constructor(
    readonly id: string,
    readonly name: string,
  ) {}
}
class Book {
  constructor(
    readonly id: string,
    readonly title: string,
    readonly author: Author,
    readonly price: number,
  ) {}
}
class AuthorDto {
  id = "";
  displayName = "";
}
class BookDto {
  id = "";
  title = "";
  author = new AuthorDto();
  price = 0;
}
class BookUpdateDto {
  title = "";
  price = 0;
}
class BookStoreProfile extends MappingProfile {
  constructor() {
    super();
    this.createMap(Author, AuthorDto, (a) => {
      const dto = new AuthorDto();
      dto.id = a.id;
      dto.displayName = a.name.toUpperCase();
      return dto;
    });
    this.createMap(Book, BookDto, (b, ctx) => {
      const dto = new BookDto();
      dto.id = b.id;
      dto.title = b.title;
      dto.price = b.price;
      dto.author = ctx.mapper.map(Author, AuthorDto, b.author);
      return dto;
    });
    this.createMapTo(BookUpdateDto, Book, (src, dest) => {
      Object.assign(dest, { title: src.title, price: src.price });
    });
  }
}

class Product {
  name = "";
  sku = "";
}
class ProductDto implements IMapTo<Product> {
  constructor(
    readonly name: string,
    readonly sku: string,
  ) {}
  mapTo(destination?: Product): Product {
    const target = destination ?? new Product();
    target.name = this.name;
    target.sku = this.sku;
    return target;
  }
}
class ProductSummary implements IMapFrom<Product> {
  label = "";
  mapFrom(source: Product): void {
    this.label = `${source.name} (${source.sku})`;
  }
}

const tolkien = new Author("a1", "Tolkien");
const hobbit = new Book("b1", "The Hobbit", tolkien, 12.5);

async function createApp(startup: typeof AbpModule & (new () => AbpModule)) {
  const app = await AbpApplication.create(startup, { configuration: { skipDefaults: true } });
  await app.initialize();
  return app;
}

describe("DefaultObjectMapper with profiles", () => {
  @DependsOn(AbpObjectMappingModule)
  class AppModule extends AbpModule {
    override configureServices(): void {
      this.configure(AbpObjectMappingOptions, (o) => o.addProfile(BookStoreProfile));
    }
  }

  it("maps with createMap and nested maps through the context", async () => {
    const app = await createApp(AppModule);
    const mapper = app.serviceProvider.getRequired(IObjectMapper);
    expect(mapper).toBeInstanceOf(DefaultObjectMapper);
    const dto = mapper.map(Book, BookDto, hobbit);
    expect(dto).toBeInstanceOf(BookDto);
    expect(dto).toEqual({ id: "b1", title: "The Hobbit", price: 12.5, author: { id: "a1", displayName: "TOLKIEN" } });
    expect(mapper.mapList(Author, AuthorDto, [tolkien, new Author("a2", "Lewis")]).map((a) => a.displayName)).toEqual(["TOLKIEN", "LEWIS"]);
    await app.shutdown();
  });

  it("maps onto an existing object with createMapTo, or falls back to member copy of createMap", async () => {
    const app = await createApp(AppModule);
    const mapper = app.serviceProvider.getRequired(IObjectMapper);
    const book = new Book("b2", "Old", tolkien, 1);
    const update = new BookUpdateDto();
    update.title = "New";
    update.price = 9;
    expect(mapper.mapTo(BookUpdateDto, Book, update, book)).toBe(book);
    expect(book.title).toBe("New");
    expect(book.price).toBe(9);

    const existing = new AuthorDto();
    expect(mapper.mapTo(Author, AuthorDto, tolkien, existing)).toBe(existing);
    expect(existing.displayName).toBe("TOLKIEN");
    expect(() => mapper.map(BookUpdateDto, Book, update)).not.toThrow();
    await app.shutdown();
  });

  it("throws a descriptive error when no map exists", async () => {
    const app = await createApp(AppModule);
    const mapper = app.serviceProvider.getRequired(IObjectMapper);
    expect(() => mapper.map(BookDto, Book, new BookDto())).toThrow(/No object mapping was found[\s\S]*BookDto -> Book/);
    expect(() => mapper.map(Book, BookDto, null as unknown as Book)).toThrow(/source/);
    await app.shutdown();
  });
});

describe("DefaultObjectMapper resolution order", () => {
  it("prefers a specific mapper registered under specificObjectMapperToken", async () => {
    class AuthorMapper implements ISpecificObjectMapper<Author, AuthorDto> {
      map(source: Author): AuthorDto {
        return this.mapTo(source, new AuthorDto());
      }
      mapTo(source: Author, destination: AuthorDto): AuthorDto {
        destination.id = source.id;
        destination.displayName = `specific:${source.name}`;
        return destination;
      }
    }
    @DependsOn(AbpObjectMappingModule)
    class AppModule extends AbpModule {
      override configureServices(context: ServiceConfigurationContext): void {
        context.services.addTransient(specificObjectMapperToken(Author, AuthorDto), AuthorMapper);
        this.configure(AbpObjectMappingOptions, (o) => o.addProfile(BookStoreProfile));
      }
    }
    const app = await createApp(AppModule);
    const mapper = app.serviceProvider.getRequired(IObjectMapper);
    expect(app.serviceProvider.getRequired(specificObjectMapperToken(Author, AuthorDto))).toBeInstanceOf(AuthorMapper);
    expect(mapper.map(Author, AuthorDto, tolkien).displayName).toBe("specific:Tolkien");
    expect(mapper.map(Book, BookDto, hobbit).author.displayName).toBe("specific:Tolkien");
    await app.shutdown();
  });

  it("uses IMapTo on the source and IMapFrom on the destination without any profile", () => {
    const services = new ServiceCollection();
    const mapper = new DefaultObjectMapper(services.buildServiceProvider(), new NotImplementedAutoObjectMappingProvider());
    const dto = new ProductDto("Lamp", "L-1");
    const product = mapper.map(ProductDto, Product, dto);
    expect(product).toBeInstanceOf(Product);
    expect(product).toEqual({ name: "Lamp", sku: "L-1" });
    const existing = new Product();
    expect(mapper.mapTo(ProductDto, Product, dto, existing)).toBe(existing);
    expect(existing.sku).toBe("L-1");
    const summary = mapper.map(Product, ProductSummary, product);
    expect(summary).toBeInstanceOf(ProductSummary);
    expect(summary.label).toBe("Lamp (L-1)");
    expect(mapper.mapTo(Product, ProductSummary, product, new ProductSummary()).label).toBe("Lamp (L-1)");
    expect(() => mapper.map(Product, BookDto, product)).toThrow(/Can not map/);
  });
});

describe("IObjectMapper<TContext>", () => {
  class OtherProfile extends MappingProfile {
    constructor() {
      super();
      this.createMap(Author, AuthorDto, (a) => {
        const dto = new AuthorDto();
        dto.id = a.id;
        dto.displayName = `ctx:${a.name}`;
        return dto;
      });
    }
  }
  @DependsOn(AbpObjectMappingModule)
  class BookStoreModule extends AbpModule {
    override configureServices(): void {
      this.configure(AbpObjectMappingOptions, (o) => o.addProfile(BookStoreProfile).addProfile(OtherProfile, BookStoreModule).addContext(Author));
    }
  }

  it("context profiles override global ones only for that context", async () => {
    const app = await createApp(BookStoreModule);
    const global = app.serviceProvider.getRequired(IObjectMapper);
    const contextual = app.serviceProvider.getRequired(objectMapperToken(BookStoreModule));
    expect(contextual).toBeInstanceOf(DefaultObjectMapper);
    expect(contextual.autoObjectMappingProvider).toBeInstanceOf(ProfileAutoObjectMappingProvider);
    expect(contextual.autoObjectMappingProvider).not.toBe(app.serviceProvider.getRequired(IAutoObjectMappingProvider));
    expect(global.map(Author, AuthorDto, tolkien).displayName).toBe("TOLKIEN");
    expect(contextual.map(Author, AuthorDto, tolkien).displayName).toBe("ctx:Tolkien");
    expect(contextual.map(Book, BookDto, hobbit).author.displayName).toBe("ctx:Tolkien");
    expect(app.serviceProvider.getRequired(objectMapperToken(Author)).map(Author, AuthorDto, tolkien).displayName).toBe("TOLKIEN");
    await app.shutdown();
  });
});

describe("helpers", () => {
  it("mapProperties copies own data properties shallowly", () => {
    const target = new BookDto();
    const author = new AuthorDto();
    const result = mapProperties({ id: "x", price: 3, author, fn: () => 1, extra: undefined }, target);
    expect(result).toBe(target);
    expect(target.id).toBe("x");
    expect(target.price).toBe(3);
    expect(target.author).toBe(author);
    expect(target.title).toBe("");
    expect("fn" in target).toBe(false);
  });

  it("MappingRegistry merges map and mapTo for the same pair, later profiles winning", () => {
    class First extends MappingProfile {
      constructor() {
        super();
        this.createMap(Author, AuthorDto, () => new AuthorDto());
      }
    }
    class Second extends MappingProfile {
      constructor() {
        super();
        this.createMapTo(Author, AuthorDto, (s, d) => (d.id = s.id));
      }
    }
    const options = new AbpObjectMappingOptions().addProfile(First).addProfile(Second);
    const definition = MappingRegistry.fromOptions(options).find(Author, AuthorDto);
    expect(definition?.map).toBeDefined();
    expect(definition?.mapTo).toBeDefined();
    expect(MappingRegistry.fromOptions(options).find(AuthorDto, Author)).toBeUndefined();
  });
});
