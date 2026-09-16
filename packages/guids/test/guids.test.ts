import { describe, expect, it } from "vitest";
import { AbpApplication, Guid } from "@abp/core";
import { AbpGuidsModule, AbpSequentialGuidGeneratorOptions, IGuidGenerator, SequentialGuidGenerator, SequentialGuidType, SimpleGuidGenerator } from "../src/index.js";

function createGenerator(): SequentialGuidGenerator {
  return new SequentialGuidGenerator({ value: new AbpSequentialGuidGeneratorOptions() });
}

describe("SequentialGuidGenerator", () => {
  it("creates valid, unique guids", () => {
    const generator = createGenerator();
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) ids.add(generator.create());
    expect(ids.size).toBe(10_000);
    for (const id of ids) expect(Guid.isValid(id)).toBe(true);
  });

  it("sets UUID v7 version and RFC 9562 variant bits", () => {
    const id = createGenerator().create();
    expect(id[14]).toBe("7");
    expect(["8", "9", "a", "b"]).toContain(id[19]);
  });

  it("encodes the creation time in the first 48 bits", () => {
    const before = Date.now();
    const id = createGenerator().create();
    const after = Date.now();
    const timestamp = parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });

  it("orders ids monotonically within the same millisecond, across instances", () => {
    const ids: string[] = [];
    for (let i = 0; i < 5_000; i++) ids.push(createGenerator().create());
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it("defaults the sequential guid type to SequentialAtEnd", () => {
    const options = new AbpSequentialGuidGeneratorOptions();
    expect(options.getDefaultSequentialGuidType()).toBe(SequentialGuidType.SequentialAtEnd);
    options.defaultSequentialGuidType = SequentialGuidType.SequentialAsString;
    expect(options.getDefaultSequentialGuidType()).toBe(SequentialGuidType.SequentialAsString);
  });
});

describe("SimpleGuidGenerator", () => {
  it("creates random v4 guids", () => {
    const id = SimpleGuidGenerator.instance.create();
    expect(Guid.isValid(id)).toBe(true);
    expect(id[14]).toBe("4");
    expect(id).not.toBe(SimpleGuidGenerator.instance.create());
  });
});

describe("AbpGuidsModule", () => {
  it("registers SequentialGuidGenerator as a transient IGuidGenerator", async () => {
    const app = await AbpApplication.create(AbpGuidsModule, { configuration: { skipDefaults: true } });
    await app.initialize();
    const generator = app.serviceProvider.getRequired(IGuidGenerator);
    expect(generator).toBeInstanceOf(SequentialGuidGenerator);
    expect(generator).not.toBe(app.serviceProvider.getRequired(IGuidGenerator));
    expect(Guid.isValid(generator.create())).toBe(true);
    await app.shutdown();
  });
});
