import { add } from "../../lib/math/index.js";

export type ButtonProps = {
  label: string;
};

export function renderButton(props: ButtonProps) {
  return `<button data-weight="${add(1, 1)}">${props.label}</button>`;
}
