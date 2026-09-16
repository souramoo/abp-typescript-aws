import type { PagedAndSortedResultRequestDto } from "../dtos/request-dtos.js";
import type { PagedResultDto } from "../dtos/result-dtos.js";
import type { IApplicationService } from "./application-service.js";

/* Ports of the CRUD application service contracts. The .NET overloads with fewer type parameters are expressed with
 * defaults: `IReadOnlyAppService<BookDto, string>` is `IReadOnlyAppService<BookDto, string, PagedAndSortedResultRequestDto, BookDto>`. */

/** Port of `IReadOnlyAppService<TGetOutputDto, TGetListOutputDto, TKey, TGetListInput>` (parameters reordered for defaults). */
export interface IReadOnlyAppService<TGetOutputDto, TKey, TGetListInput = PagedAndSortedResultRequestDto, TGetListOutputDto = TGetOutputDto> extends IApplicationService {
  get(id: TKey): Promise<TGetOutputDto>;
  getList(input: TGetListInput): Promise<PagedResultDto<TGetListOutputDto>>;
}

/** Port of `ICreateAppService<TGetOutputDto, TCreateInput>`. */
export interface ICreateAppService<TGetOutputDto, TCreateInput = TGetOutputDto> extends IApplicationService {
  create(input: TCreateInput): Promise<TGetOutputDto>;
}

/** Port of `IUpdateAppService<TGetOutputDto, TKey, TUpdateInput>`. */
export interface IUpdateAppService<TGetOutputDto, TKey, TUpdateInput = TGetOutputDto> extends IApplicationService {
  update(id: TKey, input: TUpdateInput): Promise<TGetOutputDto>;
}

/** Port of `IDeleteAppService<TKey>`. */
export interface IDeleteAppService<TKey> extends IApplicationService {
  delete(id: TKey): Promise<void>;
}

/** Port of `ICreateUpdateAppService<TGetOutputDto, TKey, TCreateInput, TUpdateInput>`. */
export interface ICreateUpdateAppService<TGetOutputDto, TKey, TCreateInput = TGetOutputDto, TUpdateInput = TCreateInput> extends ICreateAppService<TGetOutputDto, TCreateInput>, IUpdateAppService<TGetOutputDto, TKey, TUpdateInput> {}

/** Port of `ICrudAppService<TGetOutputDto, TGetListOutputDto, TKey, TGetListInput, TCreateInput, TUpdateInput>` (parameters reordered for defaults). */
export interface ICrudAppService<TGetOutputDto, TKey, TGetListInput = PagedAndSortedResultRequestDto, TCreateInput = TGetOutputDto, TUpdateInput = TCreateInput, TGetListOutputDto = TGetOutputDto>
  extends IReadOnlyAppService<TGetOutputDto, TKey, TGetListInput, TGetListOutputDto>,
    ICreateUpdateAppService<TGetOutputDto, TKey, TCreateInput, TUpdateInput>,
    IDeleteAppService<TKey> {}
