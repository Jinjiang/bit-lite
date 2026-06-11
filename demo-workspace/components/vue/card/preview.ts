import { renderCard } from "./index.js";

export default function mount(root: HTMLElement) {
  let count = 0;

  const render = () => {
    root.innerHTML = `
      <div style="display: grid; gap: 12px; max-width: 420px;">
        ${renderCard({
          title: "Vue card preview",
          body: `Rendered ${count + 1} time${count === 0 ? "" : "s"}.`,
        })}
        <button type="button">Render again</button>
      </div>
    `;
    root.querySelector("button")?.addEventListener("click", () => {
      count += 1;
      render();
    });
  };

  render();
}
