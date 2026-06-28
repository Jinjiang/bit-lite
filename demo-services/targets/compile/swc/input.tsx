type ButtonProps = {
  label: string;
};

export function Button(props: ButtonProps) {
  return <button data-kind="swc">{props.label}</button>;
}
