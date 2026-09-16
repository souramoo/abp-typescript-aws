import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, NullLoggerFactory, Transient } from "@abp/core";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import {
  AbpBlobStoringModule,
  AbpBlobStoringOptions,
  BlobAlreadyExistsException,
  BlobContainerName,
  BlobContainerNameAttribute,
  DefaultContainer,
  FileSystemBlobNamingNormalizer,
  FileSystemBlobProvider,
  IBlobContainer,
  IBlobContainerFactory,
  MemoryBlobProvider,
  blobContainerToken,
  getText,
  getTextOrNull,
  saveText,
  type BlobPipelineContext,
  type IBlobNamingNormalizer,
  type IBlobPipelineContributor,
} from "../src/index.js";

@BlobContainerName("profile-pictures")
class ProfilePictureContainer {}

class DocumentsContainer {}

class SharedContainer {}

class UnconfiguredContainer {}

@Transient()
class LowerCaseNormalizer implements IBlobNamingNormalizer {
  normalizeContainerName(containerName: string): string {
    return containerName.toLowerCase();
  }
  normalizeBlobName(blobName: string): string {
    return blobName.toLowerCase().replace(/\s+/g, "-");
  }
}

@Transient()
class ReverseContributor implements IBlobPipelineContributor {
  static saved = 0;
  async onSaving(context: BlobPipelineContext): Promise<void> {
    ReverseContributor.saved++;
    context.content = new Uint8Array([...context.content].reverse());
  }
  async onGetting(context: BlobPipelineContext): Promise<void> {
    context.content = new Uint8Array([...context.content].reverse());
  }
}

@Transient()
class PictureService {
  static readonly inject = [blobContainerToken(ProfilePictureContainer), IBlobContainer] as const;
  constructor(
    readonly pictures: IBlobContainer,
    readonly defaultContainer: IBlobContainer,
  ) {}
}

let basePath: string;
const DocumentsBlobContainer = blobContainerToken(DocumentsContainer);

@DependsOn(AbpBlobStoringModule)
class TestModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpBlobStoringOptions, (options) => {
      options.containers.configureDefault((c) => {
        c.useMemory();
        c.namingNormalizers.add(LowerCaseNormalizer);
      });
      options.containers.configure(DocumentsContainer, (c) => {
        c.useFileSystem((fs) => {
          fs.basePath = basePath;
        });
        c.pipelineContributors.add(ReverseContributor);
      });
      options.containers.configure(SharedContainer, (c) => {
        c.isMultiTenant = false;
      });
    });
  }
}

const tenantA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function createApp() {
  const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true }, loggerFactory: NullLoggerFactory.instance });
  await app.initialize();
  return app;
}

describe("blob storing", () => {
  beforeAll(async () => {
    basePath = await mkdtemp(join(tmpdir(), "abp-blobs-"));
  });
  afterAll(async () => {
    await rm(basePath, { recursive: true, force: true });
  });

  it("memory provider: save/get/exists/delete, override semantics, streams and text helpers", async () => {
    const app = await createApp();
    const { pictures } = app.serviceProvider.getRequired(PictureService);

    expect(await pictures.exists("a.png")).toBe(false);
    await pictures.save("a.png", new Uint8Array([1, 2, 3]));
    expect(await pictures.exists("a.png")).toBe(true);
    expect([...(await pictures.get("a.png"))]).toEqual([1, 2, 3]);

    await expect(pictures.save("a.png", new Uint8Array([9]))).rejects.toBeInstanceOf(BlobAlreadyExistsException);
    await pictures.save("a.png", Readable.from([Buffer.from([4]), Buffer.from([5])]), true);
    expect([...(await pictures.get("a.png"))]).toEqual([4, 5]);

    const chunks: Buffer[] = [];
    for await (const chunk of await pictures.getStream("a.png")) chunks.push(chunk as Buffer);
    expect([...Buffer.concat(chunks)]).toEqual([4, 5]);

    expect(await pictures.delete("a.png")).toBe(true);
    expect(await pictures.delete("a.png")).toBe(false);
    expect(await pictures.getOrNull("a.png")).toBeUndefined();
    expect(await pictures.getStreamOrNull("a.png")).toBeUndefined();
    await expect(pictures.get("a.png")).rejects.toThrow("Could not find the requested BLOB 'a.png' in the container 'profile-pictures'");

    await saveText(pictures, "hello.txt", "hello");
    expect(await getText(pictures, "hello.txt")).toBe("hello");
    expect(await getTextOrNull(pictures, "nope.txt")).toBeUndefined();
    await app.shutdown();
  });

  it("file system provider stores blobs under base path / host or tenant / container and runs the pipeline", async () => {
    const app = await createApp();
    const documents = app.serviceProvider.getRequired(DocumentsBlobContainer);
    const currentTenant = app.serviceProvider.getRequired(ICurrentTenant);

    await documents.save("Report 2024.txt", new Uint8Array([1, 2, 3]));
    const hostPath = join(basePath, "host", "DocumentsContainer", "Report 2024.txt");
    expect((await stat(hostPath)).isFile()).toBe(true);
    expect([...(await readFile(hostPath))]).toEqual([3, 2, 1]);
    expect([...(await documents.get("Report 2024.txt"))]).toEqual([1, 2, 3]);
    expect(ReverseContributor.saved).toBe(1);

    await expect(documents.save("Report 2024.txt", new Uint8Array([1]))).rejects.toBeInstanceOf(BlobAlreadyExistsException);
    await documents.save("Report 2024.txt", new Uint8Array([7]), true);
    expect([...(await documents.get("Report 2024.txt"))]).toEqual([7]);

    await currentTenant.run(tenantA, undefined, async () => {
      expect(await documents.exists("Report 2024.txt")).toBe(false);
      await documents.save("nested/x.bin", new Uint8Array([9]));
      expect((await stat(join(basePath, "tenants", tenantA, "DocumentsContainer", "nested", "x.bin"))).isFile()).toBe(true);
      expect(await documents.delete("nested/x.bin")).toBe(true);
    });
    expect(await documents.delete("Report 2024.txt")).toBe(true);
    expect(await documents.exists("Report 2024.txt")).toBe(false);
    await app.shutdown();
  });

  it("isolates tenants unless the container is not multi-tenant", async () => {
    const app = await createApp();
    const { pictures } = app.serviceProvider.getRequired(PictureService);
    const shared = app.serviceProvider.getRequired(IBlobContainerFactory).create(SharedContainer);
    const currentTenant = app.serviceProvider.getRequired(ICurrentTenant);

    await currentTenant.run(tenantA, undefined, async () => {
      await pictures.save("t.png", new Uint8Array([1]));
      await shared.save("s.png", new Uint8Array([2]));
    });
    expect(await pictures.exists("t.png")).toBe(false);
    expect(await shared.exists("s.png")).toBe(true);
    await currentTenant.run(tenantB, undefined, async () => {
      expect(await pictures.exists("t.png")).toBe(false);
      expect(await shared.exists("s.png")).toBe(true);
      await pictures.save("t.png", new Uint8Array([3]));
    });
    await currentTenant.run(tenantA, undefined, async () => {
      expect([...(await pictures.get("t.png"))]).toEqual([1]);
    });
    await app.shutdown();
  });

  it("normalizes container and blob names with the effective normalizers", async () => {
    const app = await createApp();
    const { pictures } = app.serviceProvider.getRequired(PictureService);
    const provider = app.serviceProvider.getRequired(MemoryBlobProvider);
    await pictures.save("My Photo.PNG", new Uint8Array([1]));
    expect([...provider["memoryStore"].keys()]).toContain("_my-photo.png_profile-pictures");
    expect(await pictures.exists("my-photo.png")).toBe(true);

    expect(new FileSystemBlobNamingNormalizer("win32").normalizeBlobName('dir/a:b*c?"d<e>f|.txt')).toBe("dir/abcdef.txt");
    expect(new FileSystemBlobNamingNormalizer("linux").normalizeBlobName("a:b.txt")).toBe("a:b.txt");
    await app.shutdown();
  });

  it("inherits the default configuration and resolves providers per container", async () => {
    const app = await createApp();
    const options = app.serviceProvider.getOptions(AbpBlobStoringOptions);
    const factory = app.serviceProvider.getRequired(IBlobContainerFactory);

    const unconfigured = options.containers.getConfiguration(UnconfiguredContainer);
    expect(unconfigured.providerType).toBe(MemoryBlobProvider);
    expect(unconfigured.getEffectiveNamingNormalizers()).toEqual([LowerCaseNormalizer]);

    const documents = options.containers.getConfiguration(DocumentsContainer);
    expect(documents.providerType).toBe(FileSystemBlobProvider);
    expect(documents.getEffectiveNamingNormalizers()).toEqual([FileSystemBlobNamingNormalizer]);
    expect(documents.getEffectivePipelineContributors()).toEqual([ReverseContributor]);
    expect(documents.getFileSystemConfiguration().basePath).toBe(basePath);
    expect(documents.getFileSystemConfiguration().appendContainerNameToBasePath).toBe(true);
    expect(() => unconfigured.getConfiguration("FileSystem.BasePath")).toThrow("Could not find the configuration value");

    const container = factory.create(UnconfiguredContainer);
    await container.save("x", new Uint8Array([1]));
    expect(await container.exists("x")).toBe(true);
    expect(await app.serviceProvider.getRequired(IBlobContainer).exists("x")).toBe(false);

    let seen: string[] = [];
    options.containers.configureAll((name) => seen.push(name));
    expect(seen.sort()).toEqual(["DocumentsContainer", "SharedContainer", "default"]);
    seen = [];
    await app.shutdown();
  });

  it("derives container names and default container from the decorator", () => {
    expect(BlobContainerNameAttribute.getContainerName(ProfilePictureContainer)).toBe("profile-pictures");
    expect(BlobContainerNameAttribute.getContainerName(DocumentsContainer)).toBe("DocumentsContainer");
    expect(BlobContainerNameAttribute.getContainerName(DefaultContainer)).toBe("default");
  });
});
