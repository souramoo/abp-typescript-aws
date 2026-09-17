import { LocalizationResourceName, type JsonLocalizationFile } from "@abp/localization";

/** Port of `MyProjectNameResource`. */
@LocalizationResourceName("TemplateApp")
export class TemplateAppResource {}

/** Port of `Localization/MyProjectName/en.json` plus the tutorial's book texts. */
export const templateAppEn: JsonLocalizationFile = {
  culture: "en",
  texts: {
    AppName: "TemplateApp",
    "Menu:Home": "Home",
    Welcome: "Welcome",
    LongWelcomeMessage: "Welcome to the application. This is a startup project based on the ABP framework. For more information, visit abp.io.",
    "Menu:BookStore": "Book Store",
    "Menu:Books": "Books",
    Books: "Books",
    NewBook: "New Book",
    Name: "Name",
    Type: "Type",
    PublishDate: "Publish date",
    Price: "Price",
    "Permission:TemplateApp": "TemplateApp",
    "Permission:Books": "Book Management",
    "Permission:Books.Create": "Creating new books",
    "Permission:Books.Edit": "Editing the books",
    "Permission:Books.Delete": "Deleting the books",
    "Enum:BookType.0": "Undefined",
    "Enum:BookType.1": "Adventure",
    "Enum:BookType.2": "Biography",
    "Enum:BookType.3": "Dystopia",
    "Enum:BookType.4": "Fantasy",
    "Enum:BookType.5": "Horror",
    "Enum:BookType.6": "Science",
    "Enum:BookType.7": "Science fiction",
    "Enum:BookType.8": "Poetry",
    "TemplateApp:BookNameAlreadyExists": "A book named '{Name}' already exists.",
  },
};
