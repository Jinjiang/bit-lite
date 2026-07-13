import { version } from "react";

export const legacyReactVersion = version;

export type LegacyBadgeProps = {
  label: string;
};

export function LegacyBadge({ label }: LegacyBadgeProps) {
  return <span data-react-version={version}>{label}</span>;
}
