import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client, type GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { AbpApplication, AbpModule, DependsOn, NullLoggerFactory } from "@abp/core";
import { AbpBlobStoringOptions, BlobAlreadyExistsException, BlobContainerName, IBlobContainerFactory, IBlobProviderSelector } from "@abp/blob-storing";
import { ICurrentTenant } from "@abp/multi-tenancy-abstractions";
import { AbpBlobStoringAwsModule, AwsBlobNamingNormalizer, AwsBlobProvider, IAwsBlobProviderClientFactory, getAwsConfiguration, useAws } from "../src/index.js";

const s3Mock = mockClient(S3Client);

class NotFound extends Error {
  override readonly name = "NotFound";
  readonly $metadata = { httpStatusCode: 404 };
}

@BlobContainerName("My_Pictures")
class PicturesContainer {}

@DependsOn(AbpBlobStoringAwsModule)
class TestModule extends AbpModule {
  override configureServices(): void {
    this.configure(AbpBlobStoringOptions, (options) => {
      options.containers.configureDefault((c) => useAws(c, (aws) => {
        aws.region = "eu-west-1";
      }));
      options.containers.configure("shared", (c) => useAws(c, (aws) => {
        aws.bucketName = "shared-bucket";
      }));
      options.containers.configure(PicturesContainer, (c) => useAws(c, (aws) => {
        aws.region = "us-east-1";
        aws.createContainerIfNotExists = true;
      }));
    });
  }
}

const tenantId = "11111111-1111-4111-8111-111111111111";

async function createApp(module: typeof AbpModule = TestModule, values: Record<string, unknown> = {}) {
  const app = await AbpApplication.create(module as never, { configuration: { skipDefaults: true, values }, loggerFactory: NullLoggerFactory.instance });
  await app.initialize();
  return app;
}

function body(bytes: Uint8Array): GetObjectCommandOutput["Body"] {
  return { transformToByteArray: async () => bytes } as unknown as GetObjectCommandOutput["Body"];
}

describe("AWS blob provider", () => {
  beforeEach(() => s3Mock.reset());

  it("selects the AWS provider for containers configured with useAws", async () => {
    const app = await createApp();
    expect(app.serviceProvider.getRequired(IBlobProviderSelector).get("default")).toBeInstanceOf(AwsBlobProvider);
    const containers = app.serviceProvider.getOptions(AbpBlobStoringOptions).containers;
    const configuration = getAwsConfiguration(containers.getConfiguration("shared"));
    expect(configuration.bucketName).toBe("shared-bucket");
    expect(configuration.region).toBe("eu-west-1");
    expect(configuration.forcePathStyle).toBe(false);
    configuration.serviceUrl = "http://localhost:4566";
    expect(configuration.forcePathStyle).toBe(true);
    expect(getAwsConfiguration(containers.getConfiguration("default")).bucketName).toBeUndefined();
  });

  it("saves into the container's own bucket under host/{blob} and refuses to overwrite unless asked", async () => {
    const app = await createApp();
    const container = app.serviceProvider.getRequired(IBlobContainerFactory).create("default");
    s3Mock.on(HeadObjectCommand).rejects(new NotFound());
    s3Mock.on(PutObjectCommand).resolves({});

    await container.save("docs/a.txt", new TextEncoder().encode("hello"));
    const put = s3Mock.commandCalls(PutObjectCommand)[0]!.args[0].input;
    expect(put).toMatchObject({ Bucket: "default", Key: "host/docs/a.txt", ContentLength: 5 });
    expect(s3Mock.commandCalls(HeadBucketCommand)).toHaveLength(0);

    s3Mock.on(HeadObjectCommand).resolves({});
    await expect(container.save("docs/a.txt", new Uint8Array([1]))).rejects.toThrow(BlobAlreadyExistsException);
    await container.save("docs/a.txt", new Uint8Array([1]), true);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(2);
  });

  it("prefixes keys with the container name when several containers share one bucket", async () => {
    const app = await createApp();
    const container = app.serviceProvider.getRequired(IBlobContainerFactory).create("shared");
    s3Mock.on(HeadObjectCommand).rejects(new NotFound());
    s3Mock.on(PutObjectCommand).resolves({});
    await container.save("docs/a.txt", new Uint8Array([1]));
    expect(s3Mock.commandCalls(PutObjectCommand)[0]!.args[0].input).toMatchObject({ Bucket: "shared-bucket", Key: "host/shared/docs/a.txt" });
  });

  it("uses the normalized container name as bucket, creates it on demand and scopes keys by tenant", async () => {
    const app = await createApp();
    const container = app.serviceProvider.getRequired(IBlobContainerFactory).create(PicturesContainer);
    s3Mock.on(HeadObjectCommand).rejects(new NotFound());
    s3Mock.on(HeadBucketCommand).rejects(new NotFound());
    s3Mock.on(CreateBucketCommand).resolves({});
    s3Mock.on(PutObjectCommand).resolves({});

    await app.serviceProvider.getRequired(ICurrentTenant).run(tenantId, undefined, () => container.save("p.png", new Uint8Array([9])));
    expect(s3Mock.commandCalls(CreateBucketCommand)[0]!.args[0].input.Bucket).toBe("mypictures");
    expect(s3Mock.commandCalls(PutObjectCommand)[0]!.args[0].input).toMatchObject({ Bucket: "mypictures", Key: `tenants/${tenantId}/p.png` });
  });

  it("gets, checks and deletes objects", async () => {
    const app = await createApp();
    const container = app.serviceProvider.getRequired(IBlobContainerFactory).create("default");
    s3Mock.on(GetObjectCommand, { Key: "host/x" }).resolves({ Body: body(new Uint8Array([1, 2])) });
    s3Mock.on(GetObjectCommand, { Key: "host/missing" }).rejects(new NotFound());
    s3Mock.on(HeadObjectCommand, { Key: "host/x" }).resolves({});
    s3Mock.on(HeadObjectCommand, { Key: "host/missing" }).rejects(new NotFound());
    s3Mock.on(DeleteObjectCommand).resolves({});

    expect(await container.get("x")).toEqual(new Uint8Array([1, 2]));
    expect(await container.getOrNull("missing")).toBeUndefined();
    expect(await container.exists("x")).toBe(true);
    expect(await container.exists("missing")).toBe(false);
    expect(await container.delete("x")).toBe(true);
    expect(await container.delete("missing")).toBe(false);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(1);

    s3Mock.on(HeadObjectCommand, { Key: "host/x" }).rejects(new Error("AccessDenied"));
    await expect(container.exists("x")).rejects.toThrow("AccessDenied");
  });

  it("caches one S3 client per connection configuration", async () => {
    const app = await createApp();
    const factory = app.serviceProvider.getRequired(IAwsBlobProviderClientFactory);
    const options = app.serviceProvider.getOptions(AbpBlobStoringOptions);
    const a = factory.getClient(getAwsConfiguration(options.containers.getConfiguration("default")));
    const b = factory.getClient(getAwsConfiguration(options.containers.getConfiguration("default")));
    const c = factory.getClient(getAwsConfiguration(options.containers.getConfiguration(PicturesContainer)));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("normalizes bucket names like .NET", () => {
    const normalizer = new AwsBlobNamingNormalizer();
    expect(normalizer.normalizeContainerName("My_Pictures")).toBe("mypictures");
    expect(normalizer.normalizeContainerName("-a..b-.c-")).toBe("a.bc");
    expect(normalizer.normalizeContainerName("x")).toBe("x00");
    expect(normalizer.normalizeContainerName("192.168.5.4")).toBe("000");
    expect(normalizer.normalizeBlobName("Dir/File.TXT")).toBe("Dir/File.TXT");
  });

  it("configures the default container from BlobStoring:Aws:BucketName when the app did not", async () => {
    @DependsOn(AbpBlobStoringAwsModule)
    class ConfiguredModule extends AbpModule {}
    const app = await createApp(ConfiguredModule, { BlobStoring: { Aws: { BucketName: "env-bucket", Region: "us-east-2" } } });
    const configuration = getAwsConfiguration(app.serviceProvider.getOptions(AbpBlobStoringOptions).containers.getConfiguration("default"));
    expect(configuration.bucketName).toBe("env-bucket");
    expect(configuration.region).toBe("us-east-2");
    expect(app.serviceProvider.getRequired(IBlobProviderSelector).get("anything")).toBeInstanceOf(AwsBlobProvider);
  });
});
