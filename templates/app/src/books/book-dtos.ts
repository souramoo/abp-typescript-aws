import type { Guid } from "@abp/core";
import { AuditedEntityDto } from "@abp/ddd-application";
import { z } from "zod";
import { BookType } from "./book.js";

export class BookDto extends AuditedEntityDto<Guid> {
  name = "";
  type = BookType.Undefined;
  publishDate: Date = new Date(0);
  price = 0;
}

/** Port of the tutorial's `CreateUpdateBookDto` (data annotations become the zod schema). */
export class CreateUpdateBookDto {
  static readonly schema = z.object({
    name: z.string().min(1).max(128),
    type: z.nativeEnum(BookType).default(BookType.Undefined),
    publishDate: z.coerce.date(),
    price: z.number().min(0).max(999),
  });

  name = "";
  type = BookType.Undefined;
  publishDate: Date = new Date(0);
  price = 0;
}
