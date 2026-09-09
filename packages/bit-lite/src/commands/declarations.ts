/**
 * What each command is, in the one place both the parser and the help renderer
 * read. An option declared here is parsed and documented from the same record,
 * so the two cannot drift: `kind` tells the parser whether a following bare
 * word belongs to the option, and `describe` is what help prints.
 *
 * Handlers live in `cli.ts` rather than here, so importing the table costs
 * nothing but this module — the parser needs the shapes, not the commands.
 */

export type CommandOptionKind = "flag" | "value";

export type CommandOption = {
  /** `flag` takes no value; `value` always consumes the next bare word. */
  kind: CommandOptionKind;
  describe: string;
  /** Rendered after the option in help, e.g. `<x.y.z>`. Values only. */
  placeholder?: string;
  alias?: readonly string[];
};

/**
 * What a command's positional arguments mean. `components` accepts component
 * patterns equivalent to `--filter`; `workspace` accepts none because the
 * command acts on the whole workspace; `command` names another command, which
 * only `help` does.
 */
export type CommandSelection = "components" | "workspace" | "command";

/**
 * Whether options the CLI does not declare are passed on or refused. A command
 * that can reach a vendor forwards them, because the vendor may define options
 * the CLI has never heard of. A command that reaches no vendor refuses them,
 * because an undeclared option there can only be a typo.
 */
export type UnknownOptionPolicy = "forward" | "reject";

export type CommandDeclaration = {
  name: string;
  /** One line, shown in the global command list. */
  summary: string;
  /** A paragraph, shown only in the command's own help. */
  description: string;
  selection: CommandSelection;
  unknownOptions: UnknownOptionPolicy;
  options: Readonly<Record<string, CommandOption>>;
  examples: readonly string[];
};

/** Options every command accepts. Nothing else belongs here. */
export const globalCommandOptions: Readonly<Record<string, CommandOption>> = {
  workspace: {
    kind: "value",
    alias: ["w"],
    placeholder: "<dir>",
    describe: "directory containing bit-lite.json (default: the current directory)",
  },
  filter: {
    kind: "value",
    placeholder: "<pattern>",
    describe: "component ID or path pattern; repeat the option to add more",
  },
  help: {
    kind: "flag",
    alias: ["h"],
    describe: "print this help",
  },
};

const declarations: readonly CommandDeclaration[] = [
  {
    name: "compile",
    summary: "compile component packages once, or watch with --watch",
    description:
      "Runs each selected component's configured compiler vendor in dependency order. " +
      "With --watch, the compiler vendor owns the watch session instead of exiting after one pass.",
    selection: "components",
    unknownOptions: "forward",
    options: {
      watch: { kind: "flag", describe: "keep the compiler vendors running instead of compiling once" },
    },
    examples: [
      "bit-lite compile",
      "bit-lite compile ui/button",
      "bit-lite compile \"ui/**\" --watch",
      "bit-lite compile -- --vendor-option",
    ],
  },
  {
    name: "diff",
    summary: "emit a unified diff of the selected components between two points",
    description:
      "Compares working content against each component's recorded head by default. " +
      "--from and --to each name a snap identifier or an assigned semantic version, and --to requires " +
      "the selection to resolve to exactly one component. Paths are addressed as a/<component-id>::<path> " +
      "so one patch can carry several components; the output is for reading, not for applying.",
    selection: "components",
    unknownOptions: "reject",
    options: {
      from: { kind: "value", placeholder: "<version>", describe: "compare from this snap or version" },
      to: { kind: "value", placeholder: "<version>", describe: "compare to this snap or version; one component only" },
      json: { kind: "flag", describe: "emit structured output" },
    },
    examples: ["bit-lite diff", "bit-lite diff ui/button", "bit-lite diff ui/button --from 1.0.0 --to 1.1.0"],
  },
  {
    name: "help",
    summary: "print help for the CLI or for one command",
    description: "With no argument, lists every command. With a command name, prints that command's help.",
    selection: "command",
    unknownOptions: "reject",
    options: {},
    examples: ["bit-lite help", "bit-lite help tag"],
  },
  {
    name: "install",
    summary: "install dependencies and link component packages",
    description:
      "Creates an isolated dependency project per env, installs external dependencies, and links component " +
      "packages. Acts on the whole workspace; it does not select components.",
    selection: "workspace",
    unknownOptions: "forward",
    options: {
      compile: { kind: "flag", describe: "compile once after installing" },
    },
    examples: ["bit-lite install", "bit-lite install --compile"],
  },
  {
    name: "link",
    summary: "regenerate component package links without installing",
    description:
      "Rewrites the links between component packages using the workspace on disk. " +
      "Acts on the whole workspace; it does not select components.",
    selection: "workspace",
    unknownOptions: "reject",
    options: {},
    examples: ["bit-lite link"],
  },
  {
    name: "log",
    summary: "list one component's recorded snaps and the versions on each",
    description:
      "Describes one component's history: every recorded snap, the versions assigned to each, and why each " +
      "version exists — its own source changed, a dependency moved, its env moved, or it had never been " +
      "released. The selection must resolve to exactly one component.",
    selection: "components",
    unknownOptions: "reject",
    options: {
      json: { kind: "flag", describe: "emit structured output; version identifiers are never abbreviated" },
    },
    examples: ["bit-lite log ui/button", "bit-lite log ui/button --json"],
  },
  {
    name: "preview",
    summary: "serve component docs and compositions",
    description:
      "Starts the shared preview endpoint and each selected env's preview vendor. " +
      "With --lazy, a prepared preview stays idle until preview traffic activates it.",
    selection: "components",
    unknownOptions: "forward",
    options: {
      host: { kind: "value", placeholder: "<host>", describe: "interface to bind" },
      port: { kind: "value", placeholder: "<port>", describe: "port to listen on" },
      lazy: { kind: "flag", describe: "defer each preview vendor until its first request" },
    },
    examples: ["bit-lite preview", "bit-lite preview ui/button", "bit-lite preview --lazy --port 3000"],
  },
  {
    name: "snap",
    summary: "record selected components in the component history store",
    description:
      "Records a projection of each selected component in dependency order, so a component's workspace " +
      "dependencies and its env carry a version before the component naming them is recorded. " +
      "The working .comp.json is never modified.",
    selection: "components",
    unknownOptions: "reject",
    options: {
      message: { kind: "value", placeholder: "<text>", describe: "replace the generated message" },
      "dry-run": { kind: "flag", describe: "report what would happen without writing anything" },
      json: { kind: "flag", describe: "emit structured output" },
    },
    examples: ["bit-lite snap", "bit-lite snap ui/button", "bit-lite snap \"ui/**\" --message \"first cut\""],
  },
  {
    name: "start",
    summary: "run compile watch, test watch, source browsing, and preview together",
    description:
      "Runs one watch session covering compile, tests, source browsing, and preview routes. " +
      "Compile and test tasks are eager; --lazy defers only preview.",
    selection: "components",
    unknownOptions: "forward",
    options: {
      host: { kind: "value", placeholder: "<host>", describe: "interface to bind" },
      port: { kind: "value", placeholder: "<port>", describe: "port to listen on" },
      lazy: { kind: "flag", describe: "defer each preview vendor until its first request" },
    },
    examples: ["bit-lite start", "bit-lite start ui/button", "bit-lite start --lazy"],
  },
  {
    name: "status",
    summary: "report each selected component's state against its recorded history",
    description:
      "Reports a component as modified if and only if snap would act on it, including when the reason is a " +
      "workspace prerequisite with uncommitted changes. --detail expands each modified component into the " +
      "files and metadata changes behind it.",
    selection: "components",
    unknownOptions: "reject",
    options: {
      detail: { kind: "flag", describe: "expand what makes each component modified" },
      json: { kind: "flag", describe: "emit structured output; version identifiers are never abbreviated" },
    },
    examples: ["bit-lite status", "bit-lite status \"ui/**\"", "bit-lite status --detail"],
  },
  {
    name: "sync",
    summary: "exchange component histories and tags with a remote",
    description:
      "Exchanges the local component history store with the remote it is configured against, or with --remote. " +
      "Acts on the whole store; it does not select components.",
    selection: "workspace",
    unknownOptions: "reject",
    options: {
      remote: { kind: "value", placeholder: "<url>", describe: "remote store to exchange with" },
    },
    examples: ["bit-lite sync", "bit-lite sync --remote git@example.com:team/store.git"],
  },
  {
    name: "tag",
    summary: "assign immutable versions to the selected components' snaps",
    description:
      "Increments each selected component's patch by default, because patch is the only increment derivable " +
      "without knowing what changed. --interactive presents the release as a whole and lets each component's " +
      "version be chosen before anything is written; --version names one explicitly and requires a single component.",
    selection: "components",
    unknownOptions: "reject",
    options: {
      interactive: { kind: "flag", describe: "choose each component's version before anything is written" },
      version: { kind: "value", placeholder: "<x.y.z>", describe: "assign an explicit version; one component only" },
      message: { kind: "value", placeholder: "<text>", describe: "replace the generated message" },
      "dry-run": { kind: "flag", describe: "report what would happen without writing anything" },
      json: { kind: "flag", describe: "emit structured output" },
    },
    examples: [
      "bit-lite tag",
      "bit-lite tag \"ui/**\" --interactive",
      "bit-lite tag ui/button --version 1.2.0",
    ],
  },
  {
    name: "test",
    summary: "run the configured test service",
    description:
      "Groups the selected components by env and runs each env's test vendor. " +
      "With --watch, the test vendors stay running.",
    selection: "components",
    unknownOptions: "forward",
    options: {
      watch: { kind: "flag", describe: "keep the test vendors running instead of running once" },
    },
    examples: ["bit-lite test", "bit-lite test ui/button", "bit-lite test --watch -- --reporter json"],
  },
  {
    name: "watch",
    summary: "alias for compile --watch",
    description:
      "Runs compile with --watch. It accepts the same workspace, filter, positional component pattern, " +
      "command-option, and passthrough forms compile accepts. --no-watch conflicts with the command. " +
      "Note that -w is --workspace, not a watch flag.",
    selection: "components",
    unknownOptions: "forward",
    options: {
      watch: { kind: "flag", describe: "already implied; --no-watch conflicts with this command" },
    },
    examples: ["bit-lite watch", "bit-lite watch ui/button"],
  },
];

export const commandDeclarations: readonly CommandDeclaration[] = declarations;

const byName = new Map(declarations.map((declaration) => [declaration.name, declaration]));

export function findCommandDeclaration(name: string): CommandDeclaration | undefined {
  return byName.get(name);
}

/**
 * A command's own options together with the globals that apply to it. Command
 * options win on a name collision, which no command currently has and the
 * completeness test keeps that way.
 *
 * `--filter` selects components, so it applies only to a command that selects
 * components. Offering it to `install` would advertise something the command
 * ignores, which is the silent-ignore this table exists to remove.
 */
export function effectiveCommandOptions(
  declaration: CommandDeclaration
): Readonly<Record<string, CommandOption>> {
  const globals: Record<string, CommandOption> = {};
  for (const [name, option] of Object.entries(globalCommandOptions)) {
    if (name === "filter" && declaration.selection !== "components") continue;
    globals[name] = option;
  }
  return { ...globals, ...declaration.options };
}
