## MODIFIED Requirements

### Requirement: Vendor command orchestration accepts open service identifiers
The command-side vendor execution API SHALL accept a non-empty service identifier as an opaque string and SHALL NOT encode the currently supported env services as a closed union in the orchestration contract. Env schema validation MAY independently restrict which services can be declared. An env-service plan SHALL derive units from the resolved env groups a command selection carries, stated as the groups themselves rather than as the command-selection type, so planning does not refer to the command layer that assembled them. It SHALL silently omit an env group that does not expose the requested resolved service without creating unavailable-service state.

#### Scenario: Existing service is planned
- **WHEN** a caller plans the string service identifier `test` for a resolved selection whose env groups expose that service
- **THEN** the plan contains one execution unit for each configured env group with its resolved service and selected canonical components

#### Scenario: Arbitrary service identifier is requested
- **WHEN** a caller supplies a non-empty service identifier that is not named in the command orchestration implementation
- **THEN** the API accepts the string without requiring a framework union change and includes any group whose resolved service map recognizes it

#### Scenario: Selected env omits the service
- **WHEN** a selected env group does not expose the requested resolved service
- **THEN** that group contributes no execution unit and no unavailable-service record

#### Scenario: Planning is asked for by something other than a command
- **WHEN** a caller holds resolved env groups without a parsed command line
- **THEN** it can plan an env service from those groups, because the plan's input names the groups and nothing else
