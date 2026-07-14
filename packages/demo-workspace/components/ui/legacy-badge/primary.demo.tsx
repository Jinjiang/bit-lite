import { createElement } from "react";
import { LegacyBadge } from "./index.js";

export function CompatibilityBadge() {
  return createElement(LegacyBadge, { label: "React compatibility preview" });
}
