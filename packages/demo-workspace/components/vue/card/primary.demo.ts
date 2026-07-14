import Card from "./index.vue";

export default {
  component: Card,
  props: {
    title: "Vue card preview",
    body: "This card is mounted from the real Vue single-file component.",
  },
};

export const MySecondDemo = {
  component: Card,
  props: {
    title: "Vue card preview 2nd",
    body: "This card is the 2nd mounted from the real Vue single-file component.",
  },
};
