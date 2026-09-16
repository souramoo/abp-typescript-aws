import { ExtensibleObject } from "@abp/object-extending";

/** Port of `IHasTotalCount`. */
export interface IHasTotalCount {
  totalCount: number;
}

/** Port of `IListResult<T>`. */
export interface IListResult<T> {
  items: readonly T[];
}

/** Port of `IPagedResult<T>`. */
export interface IPagedResult<T> extends IListResult<T>, IHasTotalCount {}

/** Port of `ListResultDto<T>`. */
export class ListResultDto<T> implements IListResult<T> {
  items: readonly T[];

  constructor(items: readonly T[] = []) {
    this.items = items;
  }
}

/** Port of `PagedResultDto<T>`. */
export class PagedResultDto<T> extends ListResultDto<T> implements IPagedResult<T> {
  totalCount: number;

  constructor(totalCount = 0, items: readonly T[] = []) {
    super(items);
    this.totalCount = totalCount;
  }
}

/** Port of `ExtensibleListResultDto<T>`. */
export class ExtensibleListResultDto<T> extends ExtensibleObject implements IListResult<T> {
  items: readonly T[];

  constructor(items: readonly T[] = []) {
    super();
    this.items = items;
  }
}

/** Port of `ExtensiblePagedResultDto<T>`. */
export class ExtensiblePagedResultDto<T> extends ExtensibleListResultDto<T> implements IPagedResult<T> {
  totalCount: number;

  constructor(totalCount = 0, items: readonly T[] = []) {
    super(items);
    this.totalCount = totalCount;
  }
}
