import type { BitLiteCommand } from "./types.js";

export const envsCommand: BitLiteCommand = {
  name: "envs",
  async run({ workspace }) {
    Object.entries(workspace.envs)
      .sort(([left], [right]) => left.localeCompare(right))
      .forEach(([name, env]) => {
        const services = Object.keys(env.services);
        console.log(`${name}  ${services.length ? services.join(", ") : "(no services)"}`);
      });
    return 0;
  },
};
