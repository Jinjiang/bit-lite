import type { BitLiteCommand } from "./types.js";

export const componentsCommand: BitLiteCommand = {
  name: "components",
  async run({ workspace }) {
    if (workspace.components.length === 0) {
      console.log("no components discovered");
      return 0;
    }
    workspace.components.forEach((component) => {
      console.log(`${component.id}  ${component.envName}  ${component.rootDir}`);
    });
    return 0;
  },
};
