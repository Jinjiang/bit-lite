import { describe, expect, it } from "vitest";
import { commandDeclarations, findCommandDeclaration } from "./declarations.js";
import { renderCommandHelp, renderCommandList, renderSynopsis } from "./help-text.js";

function declarationFor(name: string) {
  const declaration = findCommandDeclaration(name);
  if (!declaration) throw new Error(`no declaration for ${name}`);
  return declaration;
}

/**
 * Help is a function from declarations to text. Nothing here reads a workspace,
 * opens the component history store, or starts a vendor — these tests run in a
 * directory with no `bit-lite.json` and never notice.
 */
describe("help rendering", () => {
  describe("the command list", () => {
    const list = renderCommandList();

    it("names every command exactly once with its summary", () => {
      for (const declaration of commandDeclarations) {
        expect(list).toContain(declaration.summary);
        const occurrences = list.split(`\n  ${declaration.name} `).length - 1;
        expect(occurrences, `${declaration.name} appears once`).toBe(1);
      }
    });

    it("expands no command's own options", () => {
      expect(list).not.toContain("--version <x.y.z>");
      expect(list).not.toContain("--dry-run");
      expect(list).not.toContain("--lazy");
    });

    it("lists the global options and only those", () => {
      expect(list).toContain("--workspace, -w <dir>");
      expect(list).toContain("--filter <pattern>");
      expect(list).toContain("--help, -h");
    });

    it("points at per-command help", () => {
      expect(list).toContain('bit-lite help <command>');
    });
  });

  describe("a command's own help", () => {
    it("offers a positional pattern only where one is accepted", () => {
      expect(renderSynopsis(declarationFor("snap"))).toContain("[component-pattern...]");
      expect(renderSynopsis(declarationFor("install"))).not.toContain("[component-pattern...]");
      expect(renderSynopsis(declarationFor("help"))).toContain("[command]");
    });

    it("shows vendor passthrough only where undeclared options are forwarded", () => {
      expect(renderSynopsis(declarationFor("test"))).toContain("[-- ...vendor-options]");
      expect(renderSynopsis(declarationFor("snap"))).not.toContain("[-- ...vendor-options]");
    });

    it("lists the command's options together with the globals", () => {
      const help = renderCommandHelp(declarationFor("tag"));

      expect(help).toContain("--interactive");
      expect(help).toContain("--version <x.y.z>");
      expect(help).toContain("--message <text>");
      expect(help).toContain("--workspace, -w <dir>");
      expect(help).toContain("--help, -h");
    });

    it("does not leak another command's options", () => {
      const help = renderCommandHelp(declarationFor("snap"));

      expect(help).not.toContain("--interactive");
      expect(help).not.toContain("--version <x.y.z>");
    });

    it("offers --filter only to a command that selects components", () => {
      expect(renderCommandHelp(declarationFor("snap"))).toContain("--filter <pattern>");
      expect(renderCommandHelp(declarationFor("install"))).not.toContain("--filter");
      expect(renderCommandHelp(declarationFor("link"))).not.toContain("--filter");
      expect(renderCommandHelp(declarationFor("sync"))).not.toContain("--filter");
    });

    it("explains that a positional pattern equals --filter, where that applies", () => {
      expect(renderCommandHelp(declarationFor("status"))).toContain("instead of with --filter");
      expect(renderCommandHelp(declarationFor("link"))).not.toContain("instead of with --filter");
    });

    it("shows the command's examples", () => {
      const help = renderCommandHelp(declarationFor("tag"));

      for (const example of declarationFor("tag").examples) expect(help).toContain(example);
    });

    it("renders for every declared command", () => {
      for (const declaration of commandDeclarations) {
        const help = renderCommandHelp(declaration);
        expect(help, declaration.name).toContain(`bit-lite ${declaration.name}`);
        expect(help.length, declaration.name).toBeGreaterThan(0);
      }
    });
  });
});
