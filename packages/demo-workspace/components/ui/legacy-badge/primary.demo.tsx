import { createElement } from "react";
import { LegacyBadge } from "./index.js";

export default function LegacyBadgeDemo() {
  return createElement(LegacyBadge, { label: "React compatibility preview" });
}
