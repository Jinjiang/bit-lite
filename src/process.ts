import { spawn } from "node:child_process";

export type RunCommandOptions = {
  cwd: string;
  args: string[];
};

export async function runNodeScript(scriptPath: string, options: RunCommandOptions) {
  return new Promise<number>((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...options.args], {
      cwd: options.cwd,
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
