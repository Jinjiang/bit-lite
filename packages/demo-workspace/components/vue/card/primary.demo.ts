import Card from "./index.vue";

export const title = "Primary";

export default {
  component: Card,
  props: {
    title: "Vue card preview",
    body: "This card is mounted from the real Vue single-file component.",
  },
};
