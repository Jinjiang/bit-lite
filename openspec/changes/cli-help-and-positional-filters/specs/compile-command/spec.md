## MODIFIED Requirements

### Requirement: Compile accepts named selection and a universal watch flag
The `compile` command SHALL accept component selection through named options such as `--filter` and through positional component patterns, which are equivalent, and SHALL expose `--watch` as a common compiler-vendor lifecycle flag. The CLI SHALL preserve arguments after `--` as vendor passthrough. Parsed vendor arguments SHALL contain raw arguments, named options, and passthrough arguments without a positional field: a positional component pattern SHALL be consumed into the component filters during parsing and SHALL NOT reach a vendor as a positional argument.

#### Scenario: One-shot compile is requested
- **WHEN** a user runs `bit-lite compile --filter ui/button`
- **THEN** compile selects matching components and invokes their configured compiler vendors once with watch disabled

#### Scenario: Watch compile is requested
- **WHEN** a user runs `bit-lite compile --watch --filter ui/button -- --vendor-option`
- **THEN** every selected compiler vendor receives `options.watch` as true and receives `--vendor-option` as passthrough

#### Scenario: Component is selected positionally
- **WHEN** a user runs `bit-lite compile ui/button`
- **THEN** compile selects the same components as `bit-lite compile --filter ui/button` and the parsed vendor arguments carry no positional field

#### Scenario: Positional selection is combined with vendor passthrough
- **WHEN** a user runs `bit-lite compile ui/button --watch -- --vendor-option`
- **THEN** `ui/button` selects the component, `options.watch` is true, and the compiler vendor receives `--vendor-option` as passthrough
