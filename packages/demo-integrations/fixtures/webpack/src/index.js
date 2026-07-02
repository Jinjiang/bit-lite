// This browser-side log is bundled by Webpack. It is not expected to appear in
// Node stdout until a browser loads the page, but it documents the fixture entry.
console.log("[webpack app] browser entry was bundled");

// Minimal DOM content so visiting the Webpack Dev Server URL shows that the
// server is actually serving the fixture.
const app = document.querySelector("#app");
app.textContent = "Webpack Dev Server is running from a Worker Thread.";
