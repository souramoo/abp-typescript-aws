import { Transient, type Guid } from "@abp/core";
import { AbpControllerBase, Controller, HttpDelete, HttpGet, HttpPost, HttpPut, body, query, route } from "@abp/aws-lambda";
import { PagedAndSortedResultRequestDto, type PagedResultDto } from "@abp/ddd-application";
import { CreateUpdateBookDto, type BookDto } from "./book-dtos.js";
import { IBookAppService } from "./book-app-service.js";

/** Port of the conventional controller ABP generates for `BookAppService` (`/api/app/books`). */
@Transient()
@Controller("api/app/books", { remoteServiceName: "TemplateApp" })
export class BooksController extends AbpControllerBase {
  static readonly inject = [IBookAppService] as const;

  constructor(private readonly bookAppService: IBookAppService) {
    super();
  }

  @HttpGet(":id", route("id", { type: "guid" }))
  get(id: Guid): Promise<BookDto> {
    return this.bookAppService.get(id);
  }

  @HttpGet("", query(PagedAndSortedResultRequestDto))
  getList(input: PagedAndSortedResultRequestDto): Promise<PagedResultDto<BookDto>> {
    return this.bookAppService.getList(input);
  }

  @HttpPost("", body(CreateUpdateBookDto))
  create(input: CreateUpdateBookDto): Promise<BookDto> {
    return this.bookAppService.create(input);
  }

  @HttpPut(":id", route("id", { type: "guid" }), body(CreateUpdateBookDto))
  update(id: Guid, input: CreateUpdateBookDto): Promise<BookDto> {
    return this.bookAppService.update(id, input);
  }

  @HttpDelete(":id", route("id", { type: "guid" }))
  delete(id: Guid): Promise<void> {
    return this.bookAppService.delete(id);
  }
}
