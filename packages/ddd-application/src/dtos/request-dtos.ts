import { IStringLocalizerFactory, formatIndexed, type ValidationResult } from "@abp/core";
import { ExtensibleObject } from "@abp/object-extending";
import { createValidationResult, type IValidatableObject, type ValidationContext } from "@abp/validation";
import { z } from "zod";
import { AbpDddApplicationContractsResource, abpDddApplicationContractsEn } from "../localization/abp-ddd-application-contracts-resource.js";
import type { IQueryable } from "@abp/ddd-domain";

/** Port of `ILimitedResultRequest`. */
export interface ILimitedResultRequest {
  maxResultCount: number;
}
/** Port of `IPagedResultRequest`. */
export interface IPagedResultRequest extends ILimitedResultRequest {
  skipCount: number;
}
/** Port of `ISortedResultRequest`: `"Name"`, `"Name DESC"`, `"Name ASC, Age DESC"`. */
export interface ISortedResultRequest {
  sorting: string | null | undefined;
}
/** Port of `IPagedAndSortedResultRequest`. */
export interface IPagedAndSortedResultRequest extends IPagedResultRequest, ISortedResultRequest {}

export function isLimitedResultRequest(value: unknown): value is ILimitedResultRequest {
  return typeof value === "object" && value !== null && typeof (value as ILimitedResultRequest).maxResultCount === "number";
}
export function isPagedResultRequest(value: unknown): value is IPagedResultRequest {
  return isLimitedResultRequest(value) && typeof (value as IPagedResultRequest).skipCount === "number";
}
export function isSortedResultRequest(value: unknown): value is ISortedResultRequest {
  return typeof value === "object" && value !== null && "sorting" in value;
}

/** Port of `LimitedResultRequestDto.Validate`, shared with the extensible variant. */
export function validateMaxResultCount(dto: ILimitedResultRequest, maxMaxResultCount: number, dtoTypeName: string, validationContext: ValidationContext): ValidationResult[] {
  if (dto.maxResultCount <= maxMaxResultCount) return [];
  const args = ["maxResultCount", maxMaxResultCount, dtoTypeName, "maxMaxResultCount"];
  const localizer = validationContext.getService(IStringLocalizerFactory)?.create(AbpDddApplicationContractsResource);
  const localized = localizer?.get("MaxResultCountExceededExceptionMessage", ...args);
  const message = localized && !localized.resourceNotFound ? localized.value : formatIndexed(abpDddApplicationContractsEn.texts["MaxResultCountExceededExceptionMessage"] as string, ...args);
  return [createValidationResult(message, "maxResultCount")];
}

/** The zod defaults mirror the .NET property initializers (`MaxResultCount = DefaultMaxResultCount`, `SkipCount = 0`) so a query string may omit them. */
const limitedSchema = z.object({ maxResultCount: z.number().int().min(1).default(10) });
const pagedSchema = limitedSchema.extend({ skipCount: z.number().int().min(0).default(0) });
const pagedAndSortedSchema = pagedSchema.extend({ sorting: z.string().nullish() });

/** Port of `LimitedResultRequestDto` (`[Range(1, int.MaxValue)]` becomes the zod schema). */
export class LimitedResultRequestDto implements ILimitedResultRequest, IValidatableObject {
  /** Default value: 10. */
  static defaultMaxResultCount = 10;
  /** Maximum possible value of `maxResultCount`. Default value: 1,000. */
  static maxMaxResultCount = 1000;
  static readonly schema: z.ZodType = limitedSchema;

  maxResultCount: number = LimitedResultRequestDto.defaultMaxResultCount;

  validate(validationContext: ValidationContext): ValidationResult[] {
    return validateMaxResultCount(this, LimitedResultRequestDto.maxMaxResultCount, "LimitedResultRequestDto", validationContext);
  }
}

/** Port of `PagedResultRequestDto`. */
export class PagedResultRequestDto extends LimitedResultRequestDto implements IPagedResultRequest {
  static override readonly schema: z.ZodType = pagedSchema;
  skipCount = 0;
}

/** Port of `PagedAndSortedResultRequestDto`. */
export class PagedAndSortedResultRequestDto extends PagedResultRequestDto implements IPagedAndSortedResultRequest {
  static override readonly schema: z.ZodType = pagedAndSortedSchema;
  sorting: string | null | undefined = undefined;
}

/** Port of `ExtensibleLimitedResultRequestDto`. */
export class ExtensibleLimitedResultRequestDto extends ExtensibleObject implements ILimitedResultRequest, IValidatableObject {
  static defaultMaxResultCount = 10;
  static maxMaxResultCount = 1000;
  static readonly schema: z.ZodType = limitedSchema;

  maxResultCount: number = ExtensibleLimitedResultRequestDto.defaultMaxResultCount;

  override validate(validationContext: ValidationContext): ValidationResult[] {
    return [...super.validate(validationContext), ...validateMaxResultCount(this, ExtensibleLimitedResultRequestDto.maxMaxResultCount, "ExtensibleLimitedResultRequestDto", validationContext)];
  }
}

/** Port of `ExtensiblePagedResultRequestDto`. */
export class ExtensiblePagedResultRequestDto extends ExtensibleLimitedResultRequestDto implements IPagedResultRequest {
  static override readonly schema: z.ZodType = pagedSchema;
  skipCount = 0;
}

/** Port of `ExtensiblePagedAndSortedResultRequestDto`. */
export class ExtensiblePagedAndSortedResultRequestDto extends ExtensiblePagedResultRequestDto implements IPagedAndSortedResultRequest {
  static override readonly schema: z.ZodType = pagedAndSortedSchema;
  sorting: string | null | undefined = undefined;
}

/** Port of `AbpPagingQueryableExtensions.PageBy(pagedResultRequest)`. */
export function pageBy<T>(query: IQueryable<T>, pagedResultRequest: IPagedResultRequest): IQueryable<T> {
  return query.skip(pagedResultRequest.skipCount).take(pagedResultRequest.maxResultCount);
}
