import { createApp } from "vue";
import Card from "./index.vue";

export default function mount(root: HTMLElement) {
  createApp(Card, {
    title: "Vue card preview",
    body: "This card is mounted from the real Vue single-file component.",
  }).mount(root);
}
