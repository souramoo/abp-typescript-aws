import { describe, expect, it } from "vitest";
import { IdentityUser, PasswordVerificationResult, Pbkdf2PasswordHasher } from "../src/domain/index.js";

const hasher = new Pbkdf2PasswordHasher();
const user = new IdentityUser("11111111-1111-4111-8111-111111111111", "john", "john@abp.io");

describe("Pbkdf2PasswordHasher", () => {
  it("verifies ASP.NET Core Identity v3 hashes produced by PasswordHasher<TUser>", () => {
    expect(hasher.verifyHashedPassword(user, "AQAAAAIAAAAyAAAAEOMwvh3+FZxqkdMBz2ekgGhwQ4B6pZWND6zgESBuWiHw", "my password")).toBe(PasswordVerificationResult.SuccessRehashNeeded);
    expect(hasher.verifyHashedPassword(user, "AQAAAAIAAAD6AAAAIJbVi5wbMR+htSfFp8fTw8N8GOS/Sje+S/4YZcgBfU7EQuqv4OkVYmc4VJl9AGZzmRTxSkP7LtVi9IWyUxX8IAAfZ8v+ZfhjCcudtC1YERSqE1OEdXLW9VukPuJWBBjLuw==", "my password")).toBe(PasswordVerificationResult.SuccessRehashNeeded);
    expect(hasher.verifyHashedPassword(user, "AQAAAAIAAAAyAAAAEOMwvh3+FZxqkdMBz2ekgGhwQ4B6pZWND6zgESBuWiHw", "wrong")).toBe(PasswordVerificationResult.Failed);
  });

  it("produces v3 hashes (PBKDF2-HMAC-SHA512, 100000 iterations, 16-byte salt, 32-byte subkey) that verify", () => {
    const hash = hasher.hashPassword(user, "1q2w3E*");
    const bytes = Buffer.from(hash, "base64");
    expect(bytes[0]).toBe(0x01);
    expect(bytes.readUInt32BE(1)).toBe(2);
    expect(bytes.readUInt32BE(5)).toBe(100_000);
    expect(bytes.readUInt32BE(9)).toBe(16);
    expect(bytes.length).toBe(13 + 16 + 32);
    expect(hasher.verifyHashedPassword(user, hash, "1q2w3E*")).toBe(PasswordVerificationResult.Success);
    expect(hasher.verifyHashedPassword(user, hash, "1q2w3E")).toBe(PasswordVerificationResult.Failed);
    expect(hasher.hashPassword(user, "1q2w3E*")).not.toBe(hash);
  });

  it("fails on malformed hashes", () => {
    expect(hasher.verifyHashedPassword(user, "not-base64!", "x")).toBe(PasswordVerificationResult.Failed);
    expect(hasher.verifyHashedPassword(user, Buffer.from([0x07, 1, 2]).toString("base64"), "x")).toBe(PasswordVerificationResult.Failed);
  });
});
