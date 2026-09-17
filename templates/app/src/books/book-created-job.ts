import { Transient, type Guid } from "@abp/core";
import { AsyncBackgroundJob, BackgroundJob, BackgroundJobName } from "@abp/background-jobs";
import { IBlobContainer } from "@abp/blob-storing";
import type { IMultiTenant } from "@abp/multi-tenancy-abstractions";

/** Arguments of `BookCreatedJob`; `tenantId` makes the job run under the book's tenant. */
@BackgroundJobName("TemplateApp.BookCreated")
export class BookCreatedJobArgs implements IMultiTenant {
  constructor(
    public bookId: Guid,
    public name: string,
    public tenantId: Guid | null = null,
  ) {}
}

/** Name of the blob a `BookCreatedJob` run leaves in the default container (`books/<id>.txt`). */
export function bookCreatedBlobName(bookId: Guid): string {
  return `books/${bookId}.txt`;
}

/**
 * Sample background job (the tutorial has none): writes a small receipt for the new book into the default blob
 * container, which is S3 on AWS and memory locally, so a run is observable end to end.
 */
@Transient()
@BackgroundJob(BookCreatedJobArgs)
export class BookCreatedJob extends AsyncBackgroundJob<BookCreatedJobArgs> {
  static readonly inject = [IBlobContainer] as const;

  constructor(private readonly blobContainer: IBlobContainer) {
    super();
  }

  async execute(args: BookCreatedJobArgs): Promise<void> {
    const receipt = `Book "${args.name}" (${args.bookId}) was created at ${new Date().toISOString()}.`;
    await this.blobContainer.save(bookCreatedBlobName(args.bookId), new TextEncoder().encode(receipt), true);
    this.logger.info(receipt, { bookId: args.bookId, tenantId: args.tenantId ?? undefined });
  }
}
