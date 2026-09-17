import { Transient, createToken, type Guid } from "@abp/core";
import { Authorize } from "@abp/authorization";
import { IBackgroundJobManager } from "@abp/background-jobs";
import { CrudAppService, type ICrudAppService, type PagedAndSortedResultRequestDto } from "@abp/ddd-application";
import { repositoryToken, type IRepository } from "@abp/ddd-domain";
import { Book } from "./book.js";
import { BookCreatedJobArgs } from "./book-created-job.js";
import { BookDto, CreateUpdateBookDto } from "./book-dtos.js";
import { TemplateAppPermissions } from "./template-app-permissions.js";

/** Port of the tutorial's `IBookAppService`. */
export type IBookAppService = ICrudAppService<BookDto, Guid, PagedAndSortedResultRequestDto, CreateUpdateBookDto, CreateUpdateBookDto>;
export const IBookAppService = createToken<IBookAppService>("IBookAppService");

/**
 * Port of the tutorial's `BookAppService`: `CrudAppService` over the book repository with the book permissions
 * (the read permission on the class, the write permissions as policy names). Creating a book also enqueues
 * `BookCreatedJob`, which exercises the background job pipeline (SQS on AWS, the in-process worker locally).
 */
@Transient(IBookAppService)
@Authorize(TemplateAppPermissions.Books.Default)
export class BookAppService extends CrudAppService<Book, BookDto, Guid, PagedAndSortedResultRequestDto, CreateUpdateBookDto, CreateUpdateBookDto> implements IBookAppService {
  static readonly inject = [repositoryToken(Book), IBackgroundJobManager] as const;

  constructor(
    repository: IRepository<Book, Guid>,
    protected readonly backgroundJobManager: IBackgroundJobManager,
  ) {
    super(repository, { entity: Book, getOutputDto: BookDto, createInput: CreateUpdateBookDto, updateInput: CreateUpdateBookDto });
    this.getPolicyName = TemplateAppPermissions.Books.Default;
    this.getListPolicyName = TemplateAppPermissions.Books.Default;
    this.createPolicyName = TemplateAppPermissions.Books.Create;
    this.updatePolicyName = TemplateAppPermissions.Books.Edit;
    this.deletePolicyName = TemplateAppPermissions.Books.Delete;
  }

  override async create(input: CreateUpdateBookDto): Promise<BookDto> {
    const created = await super.create(input);
    await this.backgroundJobManager.enqueue(BookCreatedJobArgs, new BookCreatedJobArgs(created.id, created.name, this.currentTenant.id ?? null));
    return created;
  }
}
