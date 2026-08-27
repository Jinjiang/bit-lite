import { describe, expect, it } from "vitest";
import { ComponentHistoryError } from "./errors.js";
import {
  createObjectId,
  formatObjectId,
  getObjectIdHexLength,
  isNullObjectId,
  nullObjectId,
  objectIdsEqual,
  parseObjectId,
} from "./object-id.js";

const sha1Hex = "a".repeat(40);
const sha256Hex = "b".repeat(64);

describe("object id", () => {
  it("formats ids with their algorithm so reports never imply sha1", () => {
    expect(formatObjectId(createObjectId(sha1Hex, "sha1"))).toBe(`sha1:${sha1Hex}`);
    expect(formatObjectId(createObjectId(sha256Hex, "sha256"))).toBe(`sha256:${sha256Hex}`);
  });

  it("round-trips the qualified form", () => {
    for (const value of [`sha1:${sha1Hex}`, `sha256:${sha256Hex}`]) {
      expect(formatObjectId(parseObjectId(value))).toBe(value);
    }
  });

  it("normalizes raw git output to lower case", () => {
    expect(createObjectId(`  ${"A".repeat(40)}  `, "sha1").hex).toBe(sha1Hex);
  });

  it("infers the algorithm of an unqualified id from its length", () => {
    expect(parseObjectId(sha1Hex).algorithm).toBe("sha1");
    expect(parseObjectId(sha256Hex).algorithm).toBe("sha256");
  });

  it("rejects an unqualified id whose length matches no object format", () => {
    expect(() => parseObjectId("abc")).toThrow(ComponentHistoryError);
  });

  it("rejects an unsupported algorithm", () => {
    expect(() => parseObjectId(`sha512:${"c".repeat(128)}`)).toThrow(/unsupported object format/);
  });

  it("rejects a hex length that contradicts the declared algorithm", () => {
    expect(() => parseObjectId(`sha256:${sha1Hex}`)).toThrow(/must have 64 hex characters/);
  });

  it("rejects non-hex characters", () => {
    expect(() => createObjectId("z".repeat(40), "sha1")).toThrow(/non-hex characters/);
  });

  it("builds a null id matching the algorithm width", () => {
    expect(nullObjectId("sha1").hex).toHaveLength(getObjectIdHexLength("sha1"));
    expect(nullObjectId("sha256").hex).toHaveLength(getObjectIdHexLength("sha256"));
    expect(isNullObjectId(nullObjectId("sha256"))).toBe(true);
    expect(isNullObjectId(createObjectId(sha1Hex, "sha1"))).toBe(false);
  });

  it("treats ids from different algorithms as unequal", () => {
    const left = createObjectId("0".repeat(40), "sha1");
    const right = createObjectId("0".repeat(64), "sha256");
    expect(objectIdsEqual(left, right)).toBe(false);
    expect(objectIdsEqual(left, createObjectId("0".repeat(40), "sha1"))).toBe(true);
  });
});
