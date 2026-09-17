import { Transient } from "@abp/core";
import { DataSeedContributor, type DataSeedContext, type IDataSeedContributor } from "@abp/data";
import { repositoryToken, type IRepository } from "@abp/ddd-domain";
import { IGuidGenerator } from "@abp/guids";
import { Book, BookType } from "./book.js";

/** Port of the tutorial's `BookStoreDataSeederContributor`: two books per side (host and every tenant). */
@Transient()
@DataSeedContributor()
export class BooksDataSeedContributor implements IDataSeedContributor {
  static readonly inject = [repositoryToken(Book), IGuidGenerator] as const;

  constructor(
    private readonly bookRepository: IRepository<Book, string>,
    private readonly guidGenerator: IGuidGenerator,
  ) {}

  async seed(context: DataSeedContext): Promise<void> {
    if ((await this.bookRepository.getCount()) > 0) return;
    const tenantId = context.tenantId ?? null;
    await this.bookRepository.insert(new Book(this.guidGenerator.create(), "1984", BookType.Dystopia, new Date("1949-06-08"), 19.84, tenantId));
    await this.bookRepository.insert(new Book(this.guidGenerator.create(), "The Hitchhiker's Guide to the Galaxy", BookType.ScienceFiction, new Date("1995-09-27"), 42, tenantId));
  }
}
