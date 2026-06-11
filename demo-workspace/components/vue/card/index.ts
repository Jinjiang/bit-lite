export type CardProps = {
  title: string;
  body: string;
};

export function renderCard(props: CardProps) {
  return `
    <article class="vue-card">
      <h2>${props.title}</h2>
      <p>${props.body}</p>
    </article>
  `;
}
