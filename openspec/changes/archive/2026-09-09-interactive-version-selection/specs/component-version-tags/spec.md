## ADDED Requirements

### Requirement: Tagging accepts an interactive version selection

The `tag` command SHALL accept an `--interactive` option that lets the user decide each component's version before anything is written, as defined by the `interactive-version-selection` capability. Without the option, `tag` SHALL behave exactly as it does today, deriving a patch increment for every component.

`--interactive` SHALL compose with `--dry-run`: the plan is presented and edited, the approved result is reported, and nothing is written.

`--interactive` SHALL be refused together with `--json`, because structured output exists for a consuming program and a program cannot answer the selection. It SHALL be refused together with `--version`, because one option states the answer and the other asks for it. Each refusal SHALL name both options and SHALL happen before any component is prepared.

#### Scenario: Tagging without the option is unchanged

- **WHEN** a user runs `tag` without `--interactive`
- **THEN** every component in the release receives the patch increment derived from its own existing versions
- **AND** no interface is presented

#### Scenario: Rehearse an interactive selection

- **WHEN** a user runs `tag` with both `--interactive` and `--dry-run` and approves a selection
- **THEN** the command reports the versions each component would receive
- **AND** no component history ref, tag ref, or version anchor changes

#### Scenario: Reject structured output with interactive selection

- **WHEN** a user runs `tag` with both `--interactive` and `--json`
- **THEN** the command fails naming both options
- **AND** no component is prepared

#### Scenario: Reject an explicit version with interactive selection

- **WHEN** a user runs `tag` with both `--interactive` and `--version`
- **THEN** the command fails naming both options
- **AND** no component is prepared

## MODIFIED Requirements

### Requirement: A component with nothing new is skipped

A recording command SHALL leave a component untouched when nothing about it is new. For `snap` that means its projected content matches its current snap. For `tag` it means both that its projected content matches its current snap **and** that the snap already carries an assigned version, since a component whose content is unchanged but has never been released still has something to release.

A skipped component SHALL keep the version it already carries, and that version SHALL be what its dependents resolve to. Repeating a command therefore changes nothing: versions SHALL NOT advance for components in which nothing happened.

A version the user named deliberately SHALL override the skip, whether it was named as an explicit version or chosen through interactive selection. A derivation about whether anything is new SHALL NOT outrank a decision the user stated.

#### Scenario: Repeat a tag with nothing changed

- **WHEN** a user tags a selection twice with no change to any component's content, dependency versions, or env in between
- **THEN** the second operation assigns no version, creates no snap, and creates no tag
- **AND** every component still carries the version the first operation assigned

#### Scenario: Repeat a snap with nothing changed

- **WHEN** a user snaps a selection twice with no change in between
- **THEN** the second operation creates no commit and moves no ref

#### Scenario: A skipped dependency does not disturb its dependents

- **WHEN** a component is skipped because nothing about it is new
- **THEN** its dependents resolve it to the version it already carries
- **AND** those dependents are themselves skipped when nothing else about them changed

#### Scenario: An unchanged component that has never been released

- **WHEN** a component's content is unchanged but its snap carries no assigned version
- **THEN** tagging assigns it a version rather than skipping it

#### Scenario: Only the changed components advance

- **WHEN** a selection contains both components with changes and components without
- **THEN** only the changed components receive new versions

#### Scenario: An explicit version overrides the skip

- **WHEN** a user supplies an explicit version for a component whose content is unchanged and already carries a version
- **THEN** that version is assigned rather than skipped

#### Scenario: An interactively chosen version overrides the skip

- **WHEN** a user includes a component that would have been skipped in an interactive selection and chooses an increment for it
- **THEN** that component receives a version rather than being skipped
- **AND** its dependents are drawn into the release because the version they resolve to changed

### Requirement: Derive a version for every tagged component

Bit Lite SHALL derive each selected component's version independently, by applying that component's requested increment to the highest version already assigned to that component. The requested increment SHALL be a patch increment unless the operation supplies another, because patch is the only increment derivable without knowing what changed; choosing a minor or major increment is a statement of intent that SHALL come from the user.

A component with no assigned version SHALL receive its requested increment applied to `0.0.0`, so its first version is `0.0.1` for a patch increment, `0.1.0` for a minor increment, and `1.0.0` for a major increment.

An increment requested for one component SHALL NOT affect the increment derived for any other component, including its dependents, because a break in a component's interface is not a break in the interface of a component that depends on it.

The base for the increment SHALL come from the component's existing version tags rather than from its version anchor, because after a snap the anchor holds a snap identifier, which is not a semantic version and carries no ordering.

A user MAY override the derived version with an explicit version, and Bit Lite SHALL accept that override only when the selection resolves to exactly one component, because a single explicit version cannot describe several components.

#### Scenario: Derive the first version of a component

- **WHEN** a component with no assigned version is tagged without an explicit version
- **THEN** it receives version `0.0.1`

#### Scenario: Increment from the highest assigned version

- **WHEN** a component already carries versions `0.1.0` and `0.2.3` and is tagged without an explicit version
- **THEN** it receives version `0.2.4`

#### Scenario: Apply a requested minor increment

- **WHEN** a component already carrying `0.2.3` is tagged with a minor increment requested for it
- **THEN** it receives version `0.3.0`

#### Scenario: Apply a requested major increment

- **WHEN** a component already carrying `0.2.3` is tagged with a major increment requested for it
- **THEN** it receives version `1.0.0`

#### Scenario: Derive the first version at a requested increment

- **WHEN** a component with no assigned version is tagged with a major increment requested for it
- **THEN** it receives version `1.0.0`

#### Scenario: An increment does not propagate to dependents

- **WHEN** a component is tagged with a major increment and its dependent is drawn into the same release with no increment requested for it
- **THEN** the dependent receives its own patch increment rather than a major one

#### Scenario: Derive versions independently across components

- **WHEN** several components with different existing versions and with changes are tagged in one operation
- **THEN** each receives its own incremented version rather than a shared one

#### Scenario: Override the derived version for one component

- **WHEN** a user supplies an explicit version and the selection resolves to exactly one component
- **THEN** that component receives the supplied version instead of the derived one

#### Scenario: Reject an explicit version for several components

- **WHEN** a user supplies an explicit version and the selection resolves to more than one component
- **THEN** the command fails without creating a snap or changing any tag ref
