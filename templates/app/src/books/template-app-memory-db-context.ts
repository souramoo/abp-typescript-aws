import { MemoryDbContext } from "@abp/memory-db";
import { Book } from "./book.js";

/** The in-memory counterpart of `TemplateAppDynamoDbContext` (`pnpm dev` and tests). */
export class TemplateAppMemoryDbContext extends MemoryDbContext {
  override readonly entities = [Book];
}
