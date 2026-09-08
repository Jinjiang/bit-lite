import readline from "node:readline";
import type { WorkspaceComponent } from "bit-lite-context";
import type { ComponentVersionIncrement } from "bit-lite-history";
import { assertComponentVersion } from "bit-lite-history";
import type { TagPlanEntry, TagRelease } from "./tag.js";
import type { VersionDecision, VersionDecisions } from "../utils/version-decision.js";

/**
 * What: presents a pending release and collects a version decision per
 * component.
 *
 * Why it re-plans rather than predicting: including a component draws in
 * everything that depends on it, and that set is computed by the same code that
 * carries the release out. Predicting it here would be a second implementation
 * of one rule, and a disagreement between them would assign versions the user
 * never approved — into history that cannot be rewritten.
 *
 * The interface owns no version rules. It edits a decision map and asks for a
 * new plan; every question about what a decision means is answered elsewhere.
 */

export type SelectionInputStream = NodeJS.ReadStream & {
  isRaw?: boolean;
  isTTY?: boolean;
  setRawMode?(mode: boolean): NodeJS.ReadStream;
};

export type VersionSelectionOptions = {
  /** Every component the command selected, including ones the plan would skip. */
  components: readonly WorkspaceComponent[];
  /** The plan as it stands with no decisions made. */
  initial: TagRelease;
  /** Produces a fresh plan for an edited decision map. */
  replan: (decisions: VersionDecisions) => Promise<TagRelease>;
  stdin?: SelectionInputStream;
  stdout?: NodeJS.WriteStream;
};

export type VersionSelectionResult =
  | { kind: "confirmed"; decisions: VersionDecisions; release: TagRelease }
  | { kind: "cancelled" };

const increments: readonly ComponentVersionIncrement[] = ["patch", "minor", "major"];

export async function selectVersions(
  options: VersionSelectionOptions
): Promise<VersionSelectionResult> {
  const selection = new VersionSelection(options);
  return selection.run();
}

class VersionSelection {
  readonly #components: readonly WorkspaceComponent[];
  readonly #replan: (decisions: VersionDecisions) => Promise<TagRelease>;
  readonly #stdin: SelectionInputStream;
  readonly #stdout: NodeJS.WriteStream;

  #decisions = new Map<string, VersionDecision>();
  #release: TagRelease;
  #cursor = 0;
  /** Set while an explicit version is being typed. */
  #editing: { text: string } | undefined;
  #notice: string | undefined;
  /** Serializes re-plans so two keystrokes cannot interleave. */
  #pending: Promise<void> = Promise.resolve();
  #resolve: ((result: VersionSelectionResult) => void) | undefined;
  #keypressListener: ((input: string | undefined, key: readline.Key) => void) | undefined;
  #resizeListener: (() => void) | undefined;

  constructor(options: VersionSelectionOptions) {
    this.#components = options.components;
    this.#replan = options.replan;
    this.#release = options.initial;
    this.#stdin = options.stdin ?? (process.stdin as SelectionInputStream);
    this.#stdout = options.stdout ?? process.stdout;
  }

  run(): Promise<VersionSelectionResult> {
    return new Promise<VersionSelectionResult>((resolve) => {
      this.#resolve = resolve;
      this.#start();
      this.#render();
    });
  }

  #start(): void {
    this.#keypressListener = (input, key) => {
      // Queued so an in-flight re-plan finishes before the next key is applied.
      this.#pending = this.#pending.then(() => this.#handleKey(input, key));
    };
    this.#resizeListener = () => this.#render();

    readline.emitKeypressEvents(this.#stdin);
    this.#stdin.setRawMode?.(true);
    this.#stdin.resume();
    this.#stdin.on("keypress", this.#keypressListener);
    this.#stdout.on("resize", this.#resizeListener);
    this.#stdout.write("\x1b[?25l");
  }

  /** Restores the terminal. Runs on confirm, cancel, and interruption alike. */
  #stop(): void {
    if (this.#keypressListener) {
      this.#stdin.off("keypress", this.#keypressListener);
      this.#keypressListener = undefined;
    }
    if (this.#resizeListener) {
      this.#stdout.off("resize", this.#resizeListener);
      this.#resizeListener = undefined;
    }
    this.#stdin.setRawMode?.(false);
    this.#stdin.pause();
    this.#stdout.write("\x1b[?25h\x1b[2J\x1b[H");
  }

  #finish(result: VersionSelectionResult): void {
    this.#stop();
    this.#resolve?.(result);
    this.#resolve = undefined;
  }

  async #handleKey(input: string | undefined, key: readline.Key): Promise<void> {
    if (this.#resolve === undefined) return;

    if (this.#editing !== undefined) {
      await this.#handleEditingKey(input, key);
      return;
    }

    if (key.ctrl && key.name === "c") return this.#finish({ kind: "cancelled" });
    if (key.name === "escape") return this.#finish({ kind: "cancelled" });

    if (key.name === "return") {
      return this.#finish({
        kind: "confirmed",
        decisions: new Map(this.#decisions),
        release: this.#release,
      });
    }

    if (key.name === "up" || key.name === "down") {
      const step = key.name === "up" ? -1 : 1;
      const count = this.#components.length;
      this.#cursor = (this.#cursor + step + count) % count;
      this.#notice = undefined;
      return this.#render();
    }

    if (key.name === "left" || key.name === "right") {
      return this.#cycleIncrement(key.name === "right" ? 1 : -1);
    }

    if (key.name === "space") return this.#toggleExcluded();
    if (input === "e") return this.#beginEditing();
    if (input === "r") return this.#reset();
  }

  async #handleEditingKey(input: string | undefined, key: readline.Key): Promise<void> {
    const editing = this.#editing;
    if (editing === undefined) return;

    if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      this.#editing = undefined;
      this.#notice = undefined;
      return this.#render();
    }

    if (key.name === "return") {
      try {
        assertComponentVersion(editing.text);
      } catch (error) {
        // Reported in place: a mistyped version must not abandon the release.
        this.#notice = error instanceof Error ? error.message : String(error);
        return this.#render();
      }
      this.#editing = undefined;
      this.#notice = undefined;
      return this.#decide({ kind: "explicit", version: editing.text });
    }

    if (key.name === "backspace") {
      editing.text = editing.text.slice(0, -1);
      return this.#render();
    }

    if (input !== undefined && input.length === 1 && !key.ctrl && !key.meta) {
      editing.text += input;
      return this.#render();
    }
  }

  #beginEditing(): void {
    this.#editing = { text: "" };
    this.#notice = undefined;
    this.#render();
  }

  async #cycleIncrement(step: number): Promise<void> {
    const current = this.#decisions.get(this.#currentId());
    const index = current?.kind === "increment" ? increments.indexOf(current.increment) : 0;
    // From any other state the first press lands on patch, so a skipped row is
    // included by choosing an increment for it.
    const next =
      current?.kind === "increment"
        ? increments[(index + step + increments.length) % increments.length]!
        : increments[0]!;
    await this.#decide({ kind: "increment", increment: next });
  }

  async #toggleExcluded(): Promise<void> {
    const current = this.#decisions.get(this.#currentId());
    await this.#decide(current?.kind === "exclude" ? undefined : { kind: "exclude" });
  }

  async #reset(): Promise<void> {
    await this.#decide(undefined);
  }

  /** Applies a decision and asks for the plan it produces. */
  async #decide(decision: VersionDecision | undefined): Promise<void> {
    const componentId = this.#currentId();
    const previous = this.#decisions.get(componentId);

    if (decision === undefined) this.#decisions.delete(componentId);
    else this.#decisions.set(componentId, decision);

    try {
      this.#release = await this.#replan(new Map(this.#decisions));
      this.#notice = undefined;
    } catch (error) {
      // A refused edit — excluding a changed component something depends on,
      // for instance — is reported and rolled back, leaving the review open.
      if (previous === undefined) this.#decisions.delete(componentId);
      else this.#decisions.set(componentId, previous);
      this.#notice = error instanceof Error ? error.message : String(error);
    }
    this.#render();
  }

  #currentId(): string {
    return this.#components[this.#cursor]!.id;
  }

  #render(): void {
    const rows = this.#rows();
    const { columns, rows: height } = terminalSize(this.#stdout);
    const lines = renderSelection({
      rows,
      cursor: this.#cursor,
      columns,
      height,
      editing: this.#editing,
      notice: this.#notice,
    });
    this.#stdout.write(`\x1b[2J\x1b[H${lines.join("\n")}\n`);
  }

  #rows(): SelectionRow[] {
    const byId = new Map(this.#release.entries.map((entry) => [entry.componentId, entry]));
    return this.#components.map((component) => ({
      componentId: component.id,
      entry: byId.get(component.id),
      decision: this.#decisions.get(component.id),
    }));
  }
}

export type SelectionRow = {
  componentId: string;
  /** Absent when the component was excluded, so it is no longer in the plan. */
  entry: TagPlanEntry | undefined;
  decision: VersionDecision | undefined;
};

const keyHint =
  "↑↓ move   ←→ patch/minor/major   space exclude   e exact version   r reset   enter confirm   esc cancel";

/**
 * Pure rendering, so the layout can be asserted without a terminal. Rows scroll
 * to keep the row under edit visible and say how many are out of view.
 */
export function renderSelection(input: {
  rows: readonly SelectionRow[];
  cursor: number;
  columns: number;
  height: number;
  editing?: { text: string } | undefined;
  notice?: string | undefined;
}): string[] {
  const { rows, cursor, columns } = input;
  const releasing = rows.filter((row) => row.entry?.action === "tag").length;

  // Header, blank, hint, and up to two status lines.
  const available = Math.max(1, input.height - 5);
  const start = Math.max(0, Math.min(cursor - Math.floor(available / 2), rows.length - available));
  const visible = rows.slice(start, start + Math.max(1, available));

  const idWidth = Math.max(...rows.map((row) => row.componentId.length), 9);
  const lines: string[] = [
    `Release: ${releasing} of ${rows.length} component${rows.length === 1 ? "" : "s"}`,
    "",
  ];

  for (const [offset, row] of visible.entries()) {
    const index = start + offset;
    const marker = index === cursor ? ">" : " ";
    const line =
      `${marker} ${row.componentId.padEnd(idWidth)}  ` +
      `${describeVersions(row).padEnd(18)}` +
      `${describeChoice(row).padEnd(9)}` +
      describeReason(row);
    lines.push(line.length > columns ? line.slice(0, Math.max(0, columns - 1)) + "…" : line);
  }

  if (start > 0 || start + visible.length < rows.length) {
    const above = start;
    const below = rows.length - (start + visible.length);
    lines.push(`  … ${above} above, ${below} below`);
  }

  lines.push("");
  if (input.editing !== undefined) {
    lines.push(`exact version: ${input.editing.text}_   enter apply   esc cancel`);
  } else {
    lines.push(keyHint.length > columns ? keyHint.slice(0, Math.max(0, columns - 1)) + "…" : keyHint);
  }
  if (input.notice !== undefined) lines.push(input.notice);

  return lines;
}

function describeVersions(row: SelectionRow): string {
  if (row.entry === undefined) return "excluded";
  const current = row.entry.currentVersion ?? "—";
  if (row.entry.action === "skip") return `${current}`;
  return `${current} → ${row.entry.version}`;
}

function describeChoice(row: SelectionRow): string {
  if (row.decision === undefined) return row.entry?.action === "tag" ? "patch" : "";
  if (row.decision.kind === "increment") return row.decision.increment;
  if (row.decision.kind === "explicit") return "exact";
  return "";
}

function describeReason(row: SelectionRow): string {
  if (row.entry === undefined) return "left out of this release";
  if (row.entry.action === "skip") return "nothing new";

  const reason = row.entry.reason;
  if (reason.neverReleased) return "never released";

  const parts: string[] = [];
  if (reason.sources.includes("source")) parts.push("source changed");
  for (const change of reason.dependencies) parts.push(`${change.packageName} moved`);
  if (reason.env !== undefined) parts.push("env moved");
  if (parts.length === 0 && reason.otherMetadataChanged) parts.push("metadata changed");
  return parts.join(", ") || "selected";
}

function terminalSize(stream: NodeJS.WriteStream): { columns: number; rows: number } {
  return {
    columns: typeof stream.columns === "number" && stream.columns > 0 ? stream.columns : 80,
    rows: typeof stream.rows === "number" && stream.rows > 0 ? stream.rows : 24,
  };
}
