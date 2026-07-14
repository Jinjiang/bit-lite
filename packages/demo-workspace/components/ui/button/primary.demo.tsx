import { createElement, useState } from "react";
import { Button } from "./index.js";

export default function ButtonDemo() {
  const [count, setCount] = useState(0);

  return createElement(
    "section",
    {
      style: {
        display: "grid",
        gap: "14px",
        maxWidth: "360px",
      },
    },
    createElement("h2", { style: { margin: 0, fontSize: "18px" } }, "React button preview"),
    createElement(Button, {
      label: "Clicked",
      count,
      onClick: () => setCount((value) => value + 1),
    })
  );
}
