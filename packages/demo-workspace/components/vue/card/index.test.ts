import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compileScript, compileTemplate, parse } from "@vue/compiler-sfc";

describe("Card.vue", () => {
  it("compiles the Vue single-file component", async () => {
    const filename = fileURLToPath(new URL("./index.vue", import.meta.url));
    const source = await readFile(filename, "utf8");
    const parsed = parse(source, { filename });
    assert.equal(parsed.errors.length, 0);
    assert.ok(parsed.descriptor.template);
    assert.ok(parsed.descriptor.scriptSetup);

    const script = compileScript(parsed.descriptor, { id: "card-test" });
    const template = compileTemplate({
      id: "card-test",
      source: parsed.descriptor.template?.content ?? "",
      filename,
    });
    assert.equal(template.errors.length, 0);
    assert.match(script.content, /title/);
    assert.match(script.content, /body/);
  });
});
