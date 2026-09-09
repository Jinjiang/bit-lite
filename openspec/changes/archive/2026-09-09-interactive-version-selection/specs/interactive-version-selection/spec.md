## ADDED Requirements

### Requirement: Reviewing a release writes nothing

Presenting a pending release and editing it SHALL change no component history ref, no tag ref, and no version anchor. Objects prepared in order to compute what the release would contain SHALL remain unreachable until the user confirms, so abandoning a review leaves the store and the workspace exactly as they were.

The guarantee SHALL hold however many edits a user makes and however long a review lasts.

#### Scenario: Abandon a review

- **WHEN** a user opens an interactive selection, edits several components, and cancels
- **THEN** no component history ref, tag ref, or version anchor has changed
- **AND** no component carries a version it did not carry before

#### Scenario: Review without deciding

- **WHEN** a user opens an interactive selection and cancels without editing anything
- **THEN** nothing is written and the command reports that the release was abandoned

### Requirement: Present every component in the pending release

Interactive selection SHALL present the components a release would cover, one row each, before any of them is written. Each row SHALL carry the component's identifier, the version it currently carries, the version it would receive, and the reason it is in the release.

The reason SHALL be expressed in the change-source vocabulary the `component-history-inspection` capability defines — the component's own source changed, a workspace dependency moved, its env moved — together with the case that component has never been released. A component drawn into the release only because a prerequisite moved SHALL name the prerequisite responsible.

A component that would be skipped SHALL be presented as skipped, carrying the version it already holds, so the user can see what the release leaves alone.

#### Scenario: Present a release covering several components

- **WHEN** a release covers components changed for different reasons
- **THEN** each is presented with its current version, its proposed version, and its own reason

#### Scenario: Name the prerequisite responsible

- **WHEN** a component is in the release only because a workspace dependency of it moved
- **THEN** its row names that dependency as the reason rather than reporting a source change

#### Scenario: Present a component that has never been released

- **WHEN** a component's content is unchanged but its snap carries no assigned version
- **THEN** its row states that it has never been released

#### Scenario: Present a skipped component

- **WHEN** a component would be skipped because nothing about it is new
- **THEN** it is presented as skipped, showing the version it already carries and no proposed version

### Requirement: Choose an increment for each component independently

For each component in the release, interactive selection SHALL let the user choose a patch, minor, or major increment, or supply an explicit version. The choice SHALL apply to that component alone.

An explicit version supplied through interactive selection SHALL be validated exactly as an explicit `--version` is, so the three-number rule and the reserved snap-identifier namespace apply without a second set of rules. A rejected version SHALL be reported in place and SHALL leave the review open rather than abandoning the release.

Changing a component's increment SHALL NOT change which components are in the release, because whether a dependent is drawn in depends on whether its dependency's version changed and not on how much it changed.

#### Scenario: Choose a different increment for each component

- **WHEN** a user chooses a major increment for one component and a minor increment for another in the same release
- **THEN** each component receives a version derived from its own choice

#### Scenario: Supply an explicit version

- **WHEN** a user supplies an explicit version for a component in the release
- **THEN** that component receives the supplied version instead of a derived one

#### Scenario: Reject an invalid explicit version

- **WHEN** a user supplies a version that is not exactly three numbers, or one that occupies the reserved snap-identifier namespace
- **THEN** the selection reports the reason and keeps the review open
- **AND** the release is not abandoned and nothing is written

#### Scenario: Changing an increment leaves the release membership alone

- **WHEN** a user changes a component's increment from patch to major
- **THEN** the same components are in the release as before the change

### Requirement: Include or exclude a component, and show the consequence

Interactive selection SHALL let the user draw a skipped component into the release, and SHALL let the user exclude a component the derivation placed in it.

Including a component SHALL draw in every component that transitively depends on it, because a dependent records the version of what it depends on, and that version has changed. The rows this produces SHALL appear as part of the same edit, so the user sees the extent of the release at the moment they change it rather than after it is written.

An excluded component SHALL be removed from the operation entirely rather than merely left untagged, so that neither its version nor its recorded history moves. Its dependents that remain in the release SHALL resolve it to the version at its own canonical head.

Where an excluded component's working content differs from that head and a component remaining in the release depends on it, the operation SHALL be refused rather than carried out, because the dependent would record a version that is not the code it was built against, and a component version cannot be withdrawn once assigned. The refusal SHALL name the excluded component and the dependent requiring it. Excluding a component nothing in the release depends on SHALL always be allowed, whether or not it has changed.

The membership after an edit SHALL be computed by the same rule that governs the release when it is carried out, so what is presented and what happens cannot disagree.

#### Scenario: Include a skipped component

- **WHEN** a user includes a component that was presented as skipped
- **THEN** that component receives a version
- **AND** every component that transitively depends on it appears in the release

#### Scenario: The extent of an inclusion is visible immediately

- **WHEN** including a component draws its dependents into the release
- **THEN** those dependents are presented as part of the release before the user confirms

#### Scenario: Exclude a component

- **WHEN** a user excludes an unchanged component the derivation had placed in the release
- **THEN** that component receives no version and keeps the version it already carries
- **AND** its recorded history does not move

#### Scenario: Exclude a changed component something in the release depends on

- **WHEN** a user excludes a component whose working content differs from its recorded head while a component that depends on it remains in the release
- **THEN** the operation is refused, naming the excluded component and the dependent requiring it
- **AND** no version is assigned and no ref moves

#### Scenario: Exclude a changed component nothing in the release depends on

- **WHEN** a user excludes a changed component that no component remaining in the release depends on
- **THEN** the exclusion is allowed and that component keeps the version it already carries

#### Scenario: Include a component with no dependents

- **WHEN** a user includes a skipped component that nothing depends on
- **THEN** only that component is added to the release

### Requirement: The approved release is the release that is carried out

The components and versions the user confirms SHALL be exactly the components and versions written. Where the release computed at execution differs from the release that was approved, Bit Lite SHALL fail without writing rather than proceed, because a component version cannot be withdrawn once assigned.

#### Scenario: Confirm a release

- **WHEN** a user confirms a reviewed release
- **THEN** each component receives the version its row stated
- **AND** no component absent from the review receives a version

#### Scenario: The release changed between approval and execution

- **WHEN** the release computed at execution does not match the approved release
- **THEN** the command fails without moving any ref or writing any anchor

### Requirement: Interactive selection requires a terminal

Interactive selection SHALL require an interactive terminal for both input and output. Without one it SHALL fail with a diagnostic naming the condition and stating the non-interactive alternative.

It SHALL NOT wait for input that cannot arrive, and it SHALL NOT fall back to deriving versions without asking, because a command that writes immutable history must never quietly assign versions the user was meant to choose.

#### Scenario: No terminal is attached

- **WHEN** interactive selection is requested with input or output redirected
- **THEN** the command fails naming the condition
- **AND** does not block waiting for input

#### Scenario: The diagnostic states the alternative

- **WHEN** interactive selection fails for want of a terminal
- **THEN** the diagnostic states that omitting the option derives a patch increment for every component

### Requirement: Present a release larger than the viewport

Interactive selection SHALL remain usable when the release covers more components than the terminal can display at once, keeping the component under edit visible and indicating that further components exist.

Resizing the terminal during a review SHALL re-present the release at the new size without losing any decision already made.

#### Scenario: A release exceeds the available rows

- **WHEN** a release covers more components than fit in the terminal
- **THEN** the user can reach every component
- **AND** the interface indicates that more components exist than are shown

#### Scenario: Resize during a review

- **WHEN** the terminal is resized while a release is under review
- **THEN** the release is re-presented at the new size
- **AND** every decision already made is retained
