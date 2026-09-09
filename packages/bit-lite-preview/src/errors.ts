/**
 * Marks a failure in turning an env's preview configuration and components into
 * something a dev server can serve. Every stage of preparation raises it, so a
 * command can show the message without a stack trace.
 */
export class PreviewPreparationError extends Error {
  override name = "PreviewPreparationError";
}
