## MODIFIED Requirements

### Requirement: Committed component metadata is a projection of workspace state

The `.comp.json` recorded in a component commit SHALL be derived from workspace state rather than copied from the working file. Bit Lite SHALL produce it by applying exactly two transformations to the component's working `.comp.json`:

1. resolving every dependency whose declared specifier is the workspace placeholder to the recorded version of the workspace component providing that package;
2. injecting an `env` field carrying the component's env package name and version as declared in `bit-lite.json`, with a workspace placeholder resolved to the recorded version of the local env component and any other specifier recorded exactly as declared.

Bit Lite SHALL NOT record the resolved installed version of an external env package, so that recording remains independent of installation state. All other component-owned files SHALL be captured byte for byte.

The projection SHALL have exactly one implementation. Every operation that produces recorded component content and every operation that compares it SHALL use that implementation rather than deriving the recorded form independently, so producing and comparing can never disagree about what a component's recorded content is.

#### Scenario: Record a component that depends on a workspace component

- **WHEN** a component whose `.comp.json` declares a workspace-placeholder dependency is recorded
- **THEN** the committed `.comp.json` names that dependency's resolved version
- **AND** contains no workspace placeholder

#### Scenario: Record a component that uses a local env

- **WHEN** a component whose `bit-lite.json` entry declares a workspace-placeholder env is recorded
- **THEN** the committed `.comp.json` contains an `env` field naming the env package and the env component's resolved version

#### Scenario: Record a component that uses an external env

- **WHEN** a component's `bit-lite.json` entry declares an env with a non-placeholder specifier
- **THEN** the committed `.comp.json` records that declared specifier
- **AND** recording succeeds without resolving or reading any installed env package

#### Scenario: The version anchor never enters the commit

- **WHEN** a component is recorded
- **THEN** no version anchor appears anywhere in the committed tree, because anchors live outside every component root

#### Scenario: Re-recording an unchanged component

- **WHEN** a component is recorded twice with no change to its files, its dependencies' versions, or its env's version
- **THEN** the second operation reports the component as unchanged and creates no commit

#### Scenario: Producing and comparing share one projection

- **WHEN** a recording operation and a comparison operation each derive a component's recorded content from the same workspace state
- **THEN** both obtain identical content from the same implementation
