import { add } from "./index.js";

export default function mount(root: HTMLElement) {
  let left = 2;
  let right = 3;

  const render = () => {
    root.innerHTML = `
      <div style="display: grid; gap: 14px; max-width: 360px;">
        <h2 style="margin: 0; font-size: 18px;">Math preview</h2>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button data-action="left">Left +1</button>
          <button data-action="right">Right +1</button>
          <strong>${left} + ${right} = ${add(left, right)}</strong>
        </div>
      </div>
    `;
    root.querySelector('[data-action="left"]')?.addEventListener("click", () => {
      left += 1;
      render();
    });
    root.querySelector('[data-action="right"]')?.addEventListener("click", () => {
      right += 1;
      render();
    });
  };

  render();
}
