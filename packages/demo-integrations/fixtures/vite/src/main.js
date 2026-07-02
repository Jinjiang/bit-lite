// This browser-side log is served by Vite. It is separate from the Node-side
// plugin logs captured during Vite server startup.
console.log("[vite app] browser entry was served");

// Minimal DOM content so visiting the Vite URL confirms that the dev server is
// serving the fixture project.
const app = document.querySelector("#app");
app.textContent = "Vite Dev Server is running from a Worker Thread.";
