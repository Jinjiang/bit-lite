import { describe, expect, it } from "vitest";
import { isCompilerVendorModule } from "./index.js";

describe("isCompilerVendorModule", () => {
  it("accepts valid vendor metadata and a start function", () => {
    expect(
      isCompilerVendorModule({
        meta: {
          id: "typescript",
          label: "TypeScript",
          hint: "Compile TypeScript",
          moduleUrl: "demo-vendors/compilers/typescript",
        },
        default: () => undefined,
      })
    ).toBe(true);
  });

  it.each([
    undefined,
    {},
    {
      meta: {
        id: "typescript",
        label: "TypeScript",
        hint: "Compile TypeScript",
      },
      default: () => undefined,
    },
    {
      meta: {
        id: "typescript",
        label: "TypeScript",
        hint: "Compile TypeScript",
        moduleUrl: "demo-vendors/compilers/typescript",
      },
      default: "not a function",
    },
  ])("rejects invalid compiler vendor modules", (value) => {
    expect(isCompilerVendorModule(value)).toBe(false);
  });
});
