import { renderButton } from "./index.js";

export default function mount(root: HTMLElement) {
  let count = 0;

  const render = () => {
    root.innerHTML = `
      <div style="display: grid; gap: 14px; max-width: 360px;">
        <h2 style="margin: 0; font-size: 18px;">Button preview</h2>
        <div data-slot>${renderButton({ label: `Clicked ${count} times` })}</div>
      </div>
    `;
    root.querySelector("button")?.addEventListener("click", () => {
      count += 1;
      render();
    });
  };

  render();
}
