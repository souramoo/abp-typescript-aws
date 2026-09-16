import { describe, expect, it } from "vitest";
import { ArrayQueryable } from "@abp/ddd-domain";
import { AbpValidationException, getValidationErrors } from "@abp/validation";
import { AbpDynamicSortingGuard, EntityDto, ExtensibleEntityDto, ExtensiblePagedAndSortedResultRequestDto, FullAuditedEntityDto, LimitedResultRequestDto, ListResultDto, PagedAndSortedResultRequestDto, PagedResultDto, PagedResultRequestDto, isEntityDto, isLimitedResultRequest, isPagedResultRequest, isSortedResultRequest, pageBy } from "../src/index.js";

class BookDto extends FullAuditedEntityDto<string> {
  title = "";
}
class ExtensibleBookDto extends ExtensibleEntityDto<string> {
  title = "";
}

describe("entity DTOs", () => {
  it("expose id, object key, audit fields and a readable string", () => {
    const dto = new BookDto();
    dto.id = "b1";
    expect(dto.getObjectKey()).toBe("b1");
    expect(dto.toString()).toBe("[DTO: BookDto] Id = b1");
    expect(dto).toMatchObject({ isDeleted: false, creatorId: undefined, lastModificationTime: undefined, deletionTime: undefined });
    expect(isEntityDto(dto)).toBe(true);
    expect(isEntityDto({})).toBe(false);
    expect(Object.keys(dto)).not.toContain("__entityDto");
    expect(new BookDto().getObjectKey()).toBeUndefined();
    expect(new (class extends EntityDto<number> {})().toString()).toMatch(/Id = undefined/);
  });

  it("extensible DTOs carry extra properties", () => {
    const dto = new ExtensibleBookDto();
    dto.id = "x";
    dto.extraProperties.set("Color", "red");
    expect(JSON.parse(JSON.stringify(dto))).toEqual({ extraProperties: { Color: "red" }, id: "x", title: "" });
    expect(dto.toString()).toBe("[DTO: ExtensibleBookDto] Id = x");
  });
});

describe("result DTOs", () => {
  it("default to empty items and carry the total count", () => {
    expect(new ListResultDto().items).toEqual([]);
    expect(new PagedResultDto(3, ["a"])).toMatchObject({ totalCount: 3, items: ["a"] });
    expect(new PagedResultDto().totalCount).toBe(0);
  });
});

describe("request DTOs", () => {
  it("default and validate maxResultCount, skipCount and sorting through zod and IValidatableObject", async () => {
    const limited = new LimitedResultRequestDto();
    expect(limited.maxResultCount).toBe(10);
    expect(await getValidationErrors(limited)).toEqual([]);

    limited.maxResultCount = 0;
    expect((await getValidationErrors(limited)).map((e) => e.memberNames)).toEqual([["maxResultCount"]]);

    limited.maxResultCount = 5000;
    const errors = await getValidationErrors(limited);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.errorMessage).toBe("maxResultCount can not be more than 1000! Increase LimitedResultRequestDto.maxMaxResultCount on the server side to allow more results.");

    const paged = new PagedResultRequestDto();
    paged.skipCount = -1;
    expect((await getValidationErrors(paged)).map((e) => e.memberNames)).toEqual([["skipCount"]]);

    const sorted = new PagedAndSortedResultRequestDto();
    sorted.sorting = "title desc";
    sorted.skipCount = 20;
    expect(await getValidationErrors(sorted)).toEqual([]);
    expect(isSortedResultRequest(sorted)).toBe(true);
    expect(isPagedResultRequest(sorted)).toBe(true);
    expect(isLimitedResultRequest(sorted)).toBe(true);
    expect(isSortedResultRequest(paged)).toBe(false);
    expect(isPagedResultRequest(limited)).toBe(false);

    const extensible = new ExtensiblePagedAndSortedResultRequestDto();
    extensible.maxResultCount = 2000;
    expect((await getValidationErrors(extensible)).map((e) => e.errorMessage)).toEqual([expect.stringContaining("ExtensibleLimitedResultRequestDto.maxMaxResultCount")]);
  });

  it("honours the static limits", async () => {
    const previous = LimitedResultRequestDto.maxMaxResultCount;
    LimitedResultRequestDto.maxMaxResultCount = 5;
    try {
      const dto = new PagedResultRequestDto();
      dto.maxResultCount = 6;
      expect(await getValidationErrors(dto)).toHaveLength(1);
    } finally {
      LimitedResultRequestDto.maxMaxResultCount = previous;
    }
  });

  it("pages a query with pageBy", async () => {
    const request = new PagedResultRequestDto();
    request.skipCount = 1;
    request.maxResultCount = 2;
    expect(await pageBy(ArrayQueryable.from([1, 2, 3, 4]), request).toList()).toEqual([2, 3]);
  });
});

describe("AbpDynamicSortingGuard", () => {
  it("accepts property paths and rejects everything else", () => {
    expect(AbpDynamicSortingGuard.check("title desc, author.name")).toEqual([
      { field: "title", direction: "desc" },
      { field: "author.name", direction: "asc" },
    ]);
    expect(AbpDynamicSortingGuard.check(undefined)).toEqual([]);
    for (const bad of ["title == 1", "toString()", "1", "title sideways", "a b c", "it[\"x\"]"]) {
      expect(() => AbpDynamicSortingGuard.check(bad), bad).toThrow(AbpValidationException);
    }
  });

  it("limits sort fields to the DTO's properties, case-insensitively", () => {
    const fields = AbpDynamicSortingGuard.fieldsOf(BookDto);
    expect(fields).toEqual(expect.arrayContaining(["id", "title", "creationTime", "isDeleted"]));
    expect(AbpDynamicSortingGuard.check("Title DESC", fields)).toEqual([{ field: "Title", direction: "desc" }]);
    expect(() => AbpDynamicSortingGuard.check("price", fields)).toThrow("Sorting expression is not supported.");
    expect(AbpDynamicSortingGuard.fieldsOf(ExtensibleBookDto)).not.toContain("extraProperties");
    expect(AbpDynamicSortingGuard.fieldsOf(undefined)).toBeUndefined();
  });
});
