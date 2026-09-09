import { assertComponentVersion, type ComponentVersionIncrement } from "bit-lite-history";
import { BitLiteError } from "bit-lite-utils";

/**
 * What: the version a user chose for one component, as a value.
 *
 * Why a value rather than a prompt: the choice is what `tag` needs, and a
 * terminal is only one way to produce it. Keeping the decision separate from
 * the interface that collects it lets the derivation, the skip override, and
 * the recording policy all be tested by constructing decisions directly, and
 * keeps the selection interface from becoming the place version rules live.
 *
 * `exclude` is the counterpart to naming an increment: it states that a
 * component the derivation would have released should be left alone. It is
 * applied by narrowing the selection rather than by the policy, so an excluded
 * component's head never moves either — see `applyVersionExclusions`.
 */

export type VersionDecision =
  | { kind: "increment"; increment: ComponentVersionIncrement }
  | { kind: "explicit"; version: string }
  | { kind: "exclude" };

/** Decisions keyed by component id. A component absent from it takes the default. */
export type VersionDecisions = ReadonlyMap<string, VersionDecision>;

export const noVersionDecisions: VersionDecisions = new Map();

/**
 * Validates an explicit choice through the same gate `--version` passes, so the
 * three-number rule and the reserved snap-identifier namespace apply to an
 * interactively chosen version without a second set of rules to keep in step.
 */
function assertVersionDecision(decision: VersionDecision): VersionDecision {
  if (decision.kind === "explicit") {
    return { kind: "explicit", version: assertComponentVersion(decision.version) };
  }
  return decision;
}

/** Validates every explicit choice up front, so a bad one fails before any work. */
export function assertVersionDecisions(decisions: VersionDecisions): VersionDecisions {
  const validated = new Map<string, VersionDecision>();
  for (const [componentId, decision] of decisions) {
    try {
      validated.set(componentId, assertVersionDecision(decision));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new BitLiteError(`component "${componentId}": ${reason}`);
    }
  }
  return validated;
}

/**
 * Reports whether a decision names a version for the component, which is what
 * overrides the skip: the user said this component is part of the release, and
 * a derivation about whether anything is new does not outrank that.
 */
export function decisionNamesVersion(decision: VersionDecision | undefined): boolean {
  return decision !== undefined && decision.kind !== "exclude";
}

/** The increment a decision asks for, or `undefined` to take the default. */
export function decisionIncrement(
  decision: VersionDecision | undefined
): ComponentVersionIncrement | undefined {
  return decision?.kind === "increment" ? decision.increment : undefined;
}

/** The explicit version a decision names, if it names one. */
export function decisionExplicitVersion(decision: VersionDecision | undefined): string | undefined {
  return decision?.kind === "explicit" ? decision.version : undefined;
}

/**
 * Removes excluded components from a selection.
 *
 * Exclusion narrows the selection rather than being handled while versions are
 * assigned, because by then the component's objects have been prepared and
 * publication would move its head. A component excluded from a release must
 * keep the version it carries, and that means it must not be recorded at all.
 *
 * Narrowing makes an excluded component an ordinary out-of-selection
 * prerequisite, so the existing strictness rule applies to it: if something
 * still in the release depends on it and its working content differs from its
 * head, the operation is refused rather than recording a combination that was
 * never assembled. That refusal is the same one `--filter` already produces,
 * with the same diagnostic.
 */
export function applyVersionExclusions<T extends { id: string }>(
  selected: readonly T[],
  decisions: VersionDecisions
): T[] {
  return selected.filter((component) => decisions.get(component.id)?.kind !== "exclude");
}
