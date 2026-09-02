import { describe, expect, it } from "vitest";
import {
  abbreviateComponentVersion,
  assertNotSnapVersion,
  formatSnapVersion,
  isSnapVersion,
  parseSnapVersion,
} from "./component-version.js";
import { createObjectId } from "./object-id.js";

const sha1Hex = "9f2c3ab4d5e6f7081a2b3c4d5e6f708192a3b4c5";
const sha256Hex = `${sha1Hex}${sha1Hex.slice(0, 24)}`;

describe("snap version identifiers", () => {
  it("spells a snap as 0.0.0-g plus the complete object id", () => {
    expect(formatSnapVersion(createObjectId(sha1Hex, "sha1"))).toBe(`0.0.0-g${sha1Hex}`);
    expect(formatSnapVersion(createObjectId(sha256Hex, "sha256"))).toBe(`0.0.0-g${sha256Hex}`);
  });

  it("round-trips a formatted version back to its object id", () => {
    for (const objectId of [
      createObjectId(sha1Hex, "sha1"),
      createObjectId(sha256Hex, "sha256"),
    ]) {
      expect(parseSnapVersion(formatSnapVersion(objectId))).toEqual(objectId);
    }
  });

  it("recognizes the reserved shape and nothing else", () => {
    expect(isSnapVersion(`0.0.0-g${sha1Hex}`)).toBe(true);
    expect(isSnapVersion("0.0.0-gabc")).toBe(true);

    for (const version of [
      "1.2.3",
      "0.0.0",
      "0.0.0-rc.1",
      "0.0.0-alpha",
      `0.0.1-g${sha1Hex}`,
      `0.0.0-G${sha1Hex}`,
      `0.0.0-g${sha1Hex.toUpperCase()}`,
      `0.0.0-g${sha1Hex}+build`,
      `v0.0.0-g${sha1Hex}`,
      "0.0.0-g",
      "0.0.0-gzzz",
    ]) {
      expect(isSnapVersion(version)).toBe(false);
    }
  });

  it("stays valid semver even for an all-digit object id", () => {
    // Without the g prefix this would be a numeric prerelease identifier with a
    // leading zero, which strict semantic versioning rejects outright.
    const allDigits = "0".repeat(40);
    const version = formatSnapVersion(createObjectId(allDigits, "sha1"));

    expect(version).toBe(`0.0.0-g${allDigits}`);
    expect(isSnapVersion(version)).toBe(true);
  });

  it("returns no object id for a snap-shaped version of unsupported length", () => {
    expect(parseSnapVersion("0.0.0-gabc")).toBeUndefined();
    expect(parseSnapVersion("1.2.3")).toBeUndefined();
  });

  it("abbreviates only for display and leaves other versions alone", () => {
    expect(abbreviateComponentVersion(`0.0.0-g${sha1Hex}`)).toBe("0.0.0-g9f2c3ab4d");
    expect(abbreviateComponentVersion(`0.0.0-g${sha1Hex}`, 7)).toBe("0.0.0-g9f2c3ab");
    expect(abbreviateComponentVersion("1.4.2")).toBe("1.4.2");
  });

  it("refuses a user-supplied version in the reserved namespace", () => {
    expect(() => assertNotSnapVersion(`0.0.0-g${sha1Hex}`)).toThrow(
      "is reserved for snap identifiers"
    );
    expect(() => assertNotSnapVersion("1.4.2")).not.toThrow();
    expect(() => assertNotSnapVersion("0.0.0-rc.1")).not.toThrow();
  });
});
