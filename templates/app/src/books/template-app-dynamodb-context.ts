import { AbpDynamoDbContext, type DynamoDbModelBuilder } from "@abp/dynamodb";
import { Book } from "./book.js";

/** Port of `MyProjectNameDbContext` for the single DynamoDB table (`ConnectionStrings:Default`). */
export class TemplateAppDynamoDbContext extends AbpDynamoDbContext {
  protected override configureEntities(builder: DynamoDbModelBuilder): void {
    builder.entity(Book);
  }
}
