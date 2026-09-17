import { MappingProfile, mapProperties } from "@abp/object-mapping";
import { Book } from "./book.js";
import { BookDto, CreateUpdateBookDto } from "./book-dtos.js";

/** Port of `MyProjectNameApplicationMappingProfile` (`AddMapperlyObjectMapper<MyProjectNameApplicationModule>`). */
export class TemplateAppMappingProfile extends MappingProfile {
  constructor() {
    super();
    this.createMap(Book, BookDto, (book) => mapProperties(book, new BookDto()));
    this.createMap(CreateUpdateBookDto, Book, (input) => new Book("", input.name, input.type, input.publishDate, input.price));
    this.createMapTo(CreateUpdateBookDto, Book, (input, book) => {
      book.name = input.name;
      book.type = input.type;
      book.publishDate = input.publishDate;
      book.price = input.price;
    });
  }
}
