## ADDED Requirements

### Requirement: Worker-backed watch tasks support deferred activation
The generic vendor task lifecycle SHALL allow a caller to create a worker-backed watch task in either eager or deferred mode. Eager mode SHALL remain the default. A deferred task SHALL resolve and validate its vendor metadata and expose its stable context, vendor identity, terminal state, output buffer, result lifecycle, and idempotent `activate` and `stop` operations without constructing a worker until activation. Concurrent activation calls MUST share one start operation, and a task MUST NOT activate more than once.

#### Scenario: Existing caller creates an eager watch task
- **WHEN** a caller does not request deferred activation
- **THEN** task creation starts the runner with the existing behavior

#### Scenario: Caller creates a deferred watch task
- **WHEN** a caller requests deferred activation
- **THEN** task creation returns an idle supervisable task without constructing its worker

#### Scenario: Deferred task activates concurrently
- **WHEN** several callers activate the same idle task before its runner starts
- **THEN** they observe one shared activation and exactly one worker is constructed

#### Scenario: Idle task stops
- **WHEN** coordinated shutdown stops a deferred task before activation
- **THEN** the task settles its stopped lifecycle without importing its execution target into a worker or constructing a worker

#### Scenario: Activating task stops
- **WHEN** stop races with deferred activation
- **THEN** the task records stop intent and stops or terminates the runner if activation constructs one

## MODIFIED Requirements

### Requirement: Vendor outputs contain only produced service data
Test, preview, and compile vendor outputs SHALL contain only data produced by that vendor execution. A vendor output SHALL NOT echo the parent-owned service name, vendor identity, selected env identity, command arguments, effective config, selected component descriptors, or parent-selected output paths merely so the parent can validate equality. A preview vendor SHALL report the actual port it successfully bound because that port is produced by execution rather than selected by the parent. The parent task SHALL retain its original context, vendor metadata, host, public base path, and proxy origin and SHALL create the task result wrapper or preview server projection from that retained state plus the validated vendor output. Validators SHALL preserve additional JSON-safe vendor output fields after validating required produced fields.

#### Scenario: Test vendor reports coverage
- **WHEN** a test vendor produces normal test statistics plus a vendor-specific JSON-safe coverage result
- **THEN** the parent validates the required test output, preserves the coverage field, and attaches env/vendor/task context without requiring the vendor to echo its input

#### Scenario: Preview vendor becomes ready
- **WHEN** a preview vendor successfully binds a server using its parent-supplied host and preferred/fallback port hints
- **THEN** it reports `{ mode: "serve", port: <actual-bound-port> }` without echoing service, vendor, env, arguments, config, component descriptors, base path, proxy origin, or other parent-owned identity data

#### Scenario: Preview vendor reports an invalid port
- **WHEN** a preview vendor emits an otherwise JSON-safe result whose required actual port is missing or invalid
- **THEN** the parent rejects the preview result and does not construct an upstream server target

#### Scenario: Compile succeeds
- **WHEN** a compile vendor writes to the output directory selected by the parent
- **THEN** it may return produced artifact information or no output and is not required to echo env, component ID, service name, or output directory

#### Scenario: Vendor output uses a historical field name
- **WHEN** an otherwise valid vendor result contains an additional JSON-safe field whose name was used by an older result shape
- **THEN** validation preserves it as opaque vendor output while parent-owned context remains the source of execution identity
