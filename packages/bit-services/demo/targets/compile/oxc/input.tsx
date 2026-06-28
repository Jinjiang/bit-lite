type ButtonProps = {
  label: string;
};

export function Button(props: ButtonProps) {
  return <button data-kind="oxc">{props.label}</button>;
}
