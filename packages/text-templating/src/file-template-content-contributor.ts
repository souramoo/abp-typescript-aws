import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { AbpException, IAbpHostEnvironment, Singleton, Transient, createToken, optionsToken, removePostFix, type IOptions } from "@abp/core";
import { AbpTextTemplatingOptions } from "./abp-text-templating-options.js";
import { ITemplateContentContributor, type TemplateContentContributorContext } from "./template-content-contributor.js";
import type { TemplateDefinition } from "./template-definition.js";

/** Port of `ILocalizedTemplateContentReader`. */
export interface ILocalizedTemplateContentReader {
  getContentOrNull(culture: string | undefined): string | undefined;
}

/** Port of `NullLocalizedTemplateContentReader`. */
export class NullLocalizedTemplateContentReader implements ILocalizedTemplateContentReader {
  static readonly instance = new NullLocalizedTemplateContentReader();
  getContentOrNull(): string | undefined {
    return undefined;
  }
}

/** Port of `FileInfoLocalizedTemplateContentReader`: one file, culture-independent content. */
export class FileLocalizedTemplateContentReader implements ILocalizedTemplateContentReader {
  constructor(private readonly content: string) {}

  static read(filePath: string): FileLocalizedTemplateContentReader {
    return new FileLocalizedTemplateContentReader(readFileSync(filePath, "utf8"));
  }

  getContentOrNull(culture: string | undefined): string | undefined {
    return culture === undefined ? this.content : undefined;
  }
}

/** Port of `VirtualFolderLocalizedTemplateContentReader`: a directory of `{culture}{extension}` files. */
export class FolderLocalizedTemplateContentReader implements ILocalizedTemplateContentReader {
  private readonly contents = new Map<string, string>();

  constructor(directoryPath: string, extensions: readonly string[]) {
    if (!existsSync(directoryPath) || !statSync(directoryPath).isDirectory()) throw new AbpException(`Could not find a folder at the location: ${directoryPath}`);
    for (const fileName of readdirSync(directoryPath)) {
      const filePath = join(directoryPath, fileName);
      if (!statSync(filePath).isFile()) continue;
      this.contents.set(removePostFix(basename(fileName), ...extensions), readFileSync(filePath, "utf8"));
    }
  }

  getContentOrNull(culture: string | undefined): string | undefined {
    return culture === undefined ? undefined : this.contents.get(culture);
  }
}

/** Port of `ILocalizedTemplateContentReaderFactory`. */
export interface ILocalizedTemplateContentReaderFactory {
  create(templateDefinition: TemplateDefinition): Promise<ILocalizedTemplateContentReader>;
}
export const ILocalizedTemplateContentReaderFactory = createToken<ILocalizedTemplateContentReaderFactory>("ILocalizedTemplateContentReaderFactory");

/**
 * Port of `LocalizedTemplateContentReaderFactory` over the real file system. The path comes from the definition
 * (`withFilePath`) or from `AbpTextTemplatingOptions.fileTemplateRootPath` (`{root}/{name}` directory or
 * `{root}/{name}{extension}` file). Readers are cached except in the Development environment.
 */
@Singleton(ILocalizedTemplateContentReaderFactory)
export class LocalizedTemplateContentReaderFactory implements ILocalizedTemplateContentReaderFactory {
  static readonly inject = [optionsToken(AbpTextTemplatingOptions), IAbpHostEnvironment] as const;
  protected readonly options: AbpTextTemplatingOptions;
  protected readonly readerCache = new Map<string, ILocalizedTemplateContentReader>();

  constructor(
    options: IOptions<AbpTextTemplatingOptions>,
    protected readonly hostEnvironment: IAbpHostEnvironment,
  ) {
    this.options = options.value;
  }

  async create(templateDefinition: TemplateDefinition): Promise<ILocalizedTemplateContentReader> {
    if (this.hostEnvironment.isDevelopment()) return this.createInternal(templateDefinition);
    let reader = this.readerCache.get(templateDefinition.name);
    if (!reader) {
      reader = this.createInternal(templateDefinition);
      this.readerCache.set(templateDefinition.name, reader);
    }
    return reader;
  }

  protected createInternal(templateDefinition: TemplateDefinition): ILocalizedTemplateContentReader {
    const explicitPath = templateDefinition.getFilePathOrNull();
    if (explicitPath !== undefined) {
      if (!existsSync(explicitPath)) throw new AbpException(`Could not find a file/folder at the location: ${explicitPath}`);
      return this.createReader(explicitPath);
    }

    const root = this.options.fileTemplateRootPath;
    if (root === undefined) return NullLocalizedTemplateContentReader.instance;
    const directory = join(root, templateDefinition.name);
    if (existsSync(directory) && statSync(directory).isDirectory()) return this.createReader(directory);
    for (const extension of this.options.fileTemplateExtensions) {
      const file = join(root, templateDefinition.name + extension);
      if (existsSync(file) && statSync(file).isFile()) return this.createReader(file);
    }
    return NullLocalizedTemplateContentReader.instance;
  }

  protected createReader(path: string): ILocalizedTemplateContentReader {
    if (statSync(path).isDirectory()) return new FolderLocalizedTemplateContentReader(path, this.options.fileTemplateExtensions);
    return FileLocalizedTemplateContentReader.read(path);
  }
}

/** Port of `VirtualFileTemplateContentContributor` on the real file system. */
@Transient()
@ITemplateContentContributor()
export class FileTemplateContentContributor implements ITemplateContentContributor {
  static readonly inject = [ILocalizedTemplateContentReaderFactory] as const;

  constructor(private readonly readerFactory: ILocalizedTemplateContentReaderFactory) {}

  async getOrNull(context: TemplateContentContributorContext): Promise<string | undefined> {
    const reader = await this.readerFactory.create(context.templateDefinition);
    return reader.getContentOrNull(context.culture);
  }
}
