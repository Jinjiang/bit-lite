import { pathToFileURL } from "node:url";

export function createGreeting(name = "bit-lite") {
  return `${name}: ready`;
}

export function main() {
  console.log(createGreeting());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
