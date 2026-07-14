import { createElement } from "react";
import { LegacyBadge } from "./index.js";

export const title = "Compatibility badge";

export default function LegacyBadgeDemo() {
  return createElement(LegacyBadge, { label: "React compatibility preview" });
}
