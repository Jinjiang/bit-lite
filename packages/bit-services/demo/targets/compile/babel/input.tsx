type ButtonProps = {
  label: string;
};

export function Button(props: ButtonProps) {
  return <button data-kind="babel">{props.label}</button>;
}
