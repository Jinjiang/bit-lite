type ButtonProps = {
  label: string;
};

export function Button(props: ButtonProps) {
  return <button data-kind="esbuild">{props.label}</button>;
}
