import { describe, expect, it } from "vitest";
import { createInstallReporter, type InstallProgressStream } from "./install-reporter.js";

describe("interactive install reporter", () => {
  it("replaces the active line and preserves diagnostics and completed phases", () => {
    const stream = new MemoryStream(true);
    const reporter = createInstallReporter({ stream });

    reporter.start("Reading workspace");
    reporter.succeed("Found 2 component packages");
    reporter.start("Installing dependencies");
    reporter.dependency(progress(1, 0, 1, 0));
    reporter.dependency({ type: "optional-skip", reason: "unsupported-platform", count: 1 });
    reporter.dependency({ type: "optional-skip", reason: "unsupported-platform", count: 2 });
    reporter.dependency({ type: "warning", message: "registry warning" });
    reporter.succeed("Installed dependencies");
    reporter.close();

    const output = stream.output;
    expect(output).toContain("\r\u001b[2K- Reading workspace");
    expect(output).toContain("✓ Found 2 component packages\n");
    expect(output).toContain("resolved 1, reused 0, downloaded 1, added 0");
    expect(output).toContain("! registry warning\n");
    expect(output.match(/resolved 1, reused 0, downloaded 1, added 0/g)).toHaveLength(3);
    expect(output.match(/Skipped 2 optional packages for other platforms/g)).toHaveLength(1);
    expect(output).toContain("✓ Installed dependencies\n");
  });

  it("selects interactivity from the destination stream", () => {
    const stream = new MemoryStream(true);
    const reporter = createInstallReporter({ stream });

    reporter.start("Installing dependencies");
    reporter.close();

    expect(stream.output).toContain("\r\u001b[2K");
    expect(stream.output).not.toContain("[install]");
  });

  it("finalizes failures and clears an unfinished status on close", () => {
    const failed = new MemoryStream(true);
    const failedReporter = createInstallReporter({ stream: failed });
    failedReporter.start("Compiling 2 component packages");
    failedReporter.fail("Compilation failed");
    failedReporter.close();

    expect(failed.output).toContain("✗ Compilation failed\n");

    const unfinished = new MemoryStream(true);
    const unfinishedReporter = createInstallReporter({ stream: unfinished });
    unfinishedReporter.start("Linking component packages");
    unfinishedReporter.close();

    expect(unfinished.output.endsWith("\r\u001b[2K")).toBe(true);
  });
});

describe("non-interactive install reporter", () => {
  it("writes append-only records and flushes the last throttled counters", () => {
    let time = 0;
    const stream = new MemoryStream(false);
    const reporter = createInstallReporter({
      stream,
      now: () => time,
      progressIntervalMs: 100,
    });

    reporter.start("Installing dependencies");
    reporter.dependency(progress(1, 0, 1, 0));
    time = 10;
    reporter.dependency(progress(2, 0, 2, 1));
    reporter.succeed("Installed dependencies");
    reporter.close();

    expect(stream.output).toBe(
      "[install] Installing dependencies\n" +
      "[install] Installing dependencies: resolved 1, reused 0, downloaded 1, added 0\n" +
      "[install] Installing dependencies: resolved 2, reused 0, downloaded 2, added 1\n" +
      "[install] Installed dependencies\n"
    );
    expect(stream.output).not.toMatch(/[\r\u001b]/);
  });

  it("reports cached zero-download progress, warnings, and sanitized retries", () => {
    const stream = new MemoryStream(false);
    const reporter = createInstallReporter({ stream });

    reporter.start("Installing dependencies");
    reporter.dependency(progress(4, 4, 0, 4));
    reporter.dependency({ type: "warning", message: "using cached metadata" });
    reporter.dependency({
      type: "retry",
      attempt: 1,
      maxRetries: 2,
      method: "GET",
      url: "https://token:secret@registry.example/pkg",
      timeout: 1_000,
      errorCode: "ECONNRESET",
    });
    reporter.succeed("Installed dependencies");

    expect(stream.output).toContain("resolved 4, reused 4, downloaded 0, added 4");
    expect(stream.output).toContain("[install] warning: using cached metadata\n");
    expect(stream.output).toContain(
      "[install] retry: GET https://registry.example/pkg failed (ECONNRESET); " +
      "retrying in 1000ms, 2 retries left\n"
    );
    expect(stream.output).not.toContain("secret");
  });

  it("summarizes optional packages for other platforms once at phase completion", () => {
    const stream = new MemoryStream(false);
    const reporter = createInstallReporter({ stream });

    reporter.start("Installing dependencies");
    reporter.dependency({ type: "optional-skip", reason: "unsupported-platform", count: 1 });
    reporter.dependency({ type: "optional-skip", reason: "unsupported-platform", count: 3 });

    expect(stream.output).not.toContain("Skipped");

    reporter.succeed("Installed dependencies");
    reporter.close();

    expect(stream.output).toBe(
      "[install] Installing dependencies\n" +
      "[install] warning: Skipped 3 optional packages for other platforms\n" +
      "[install] Installed dependencies\n"
    );
  });

  it("deduplicates unchanged status and package statistics", () => {
    const stream = new MemoryStream(false);
    const reporter = createInstallReporter({ stream });

    reporter.start("Installing dependencies");
    reporter.dependency({ type: "stats", added: 8, removed: 0 });
    reporter.dependency({ type: "stats", added: 8, removed: 0 });
    reporter.dependency({ type: "stage", stage: "resolution", status: "started" });
    reporter.dependency({ type: "stage", stage: "resolution", status: "started" });

    expect(stream.output.match(/packages \+8/g)).toHaveLength(1);
    expect(stream.output.match(/resolving packages/g)).toHaveLength(1);
  });

  it("does not let a progress stream failure escape", () => {
    const reporter = createInstallReporter({
      stream: {
        isTTY: false,
        write() {
          throw new Error("stream failed");
        },
      },
    });

    expect(() => {
      reporter.start("Reading workspace");
      reporter.fail("Workspace discovery failed");
      reporter.close();
    }).not.toThrow();
  });

  it("writes a durable failed phase without duplicating its failure label", () => {
    const stream = new MemoryStream(false);
    const reporter = createInstallReporter({ stream });

    reporter.start("Reading workspace");
    reporter.fail("Workspace discovery failed");
    reporter.close();

    expect(stream.output).toBe(
      "[install] Reading workspace\n" +
      "[install] Workspace discovery failed\n"
    );
  });
});

function progress(
  resolved: number,
  reused: number,
  downloaded: number,
  added: number
) {
  return {
    type: "progress" as const,
    counts: { resolved, reused, downloaded, added },
  };
}

class MemoryStream implements InstallProgressStream {
  output = "";

  constructor(readonly isTTY: boolean) {}

  write(value: string) {
    this.output += value;
    return true;
  }
}
