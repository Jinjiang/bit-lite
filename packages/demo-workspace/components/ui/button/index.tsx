import { add } from "@my-scope/lib.math";

export type ButtonProps = {
  label: string;
  count?: number;
  onClick?: () => void;
};

export function Button(props: ButtonProps) {
  return (
    <button
      type="button"
      data-weight={add(1, 1)}
      onClick={props.onClick}
      style={{
        appearance: "none",
        border: "1px solid #1f2937",
        borderRadius: "6px",
        background: "#1f2937",
        color: "#fff",
        cursor: "pointer",
        font: "inherit",
        padding: "10px 14px",
      }}
    >
      {props.count === undefined ? props.label : `${props.label}: ${props.count}`}
    </button>
  );
}
