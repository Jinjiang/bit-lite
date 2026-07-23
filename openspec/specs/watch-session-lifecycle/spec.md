## Purpose

Define user termination, root supervision, contribution ownership, bounded logical-task stopping, and private runner shutdown for resident watch sessions.

## Requirements

### Requirement: Resident watch sessions accept signal-only user termination
A resident standalone or composed watch session SHALL accept Ctrl+C, SIGINT, and SIGTERM as its only user-triggered termination inputs. An interactive managed terminal MUST translate Ctrl+C received in raw mode into the same shutdown path as SIGINT and MUST NOT terminate the session for `q` or another menu key. Startup failure, an empty task selection, and caller-invoked resource disposal MAY end a command without being treated as user-triggered watch termination.

#### Scenario: Ctrl+C is typed in the task menu
- **WHEN** a user types Ctrl+C while an interactive resident watch session owns stdin in raw mode
- **THEN** the root session enters its SIGINT shutdown path and the input is not forwarded to an attached child task

#### Scenario: Q is typed in the task menu
- **WHEN** a user types `q` while a resident watch session is showing its managed task menu
- **THEN** the session remains active and no task or contribution is disposed

#### Scenario: SIGTERM is delivered externally
- **WHEN** the process running a resident watch session receives SIGTERM
- **THEN** the root session enters its SIGTERM shutdown path

#### Scenario: No watch tasks are prepared
- **WHEN** a standalone watch command finds no tasks before entering resident supervision
- **THEN** it reports the empty selection and returns normally without installing a resident shutdown owner

### Requirement: One root session owns signals and aggregate shutdown
Each resident watch session SHALL have exactly one root owner for process signal listeners and managed-terminal lifecycle. Child contribution factories, logical tasks, runners, and vendors MUST NOT install process signal handlers or managed terminals. On the first supported termination signal, the root owner SHALL stop terminal input and restore terminal mode before awaiting asynchronous cleanup, invoke its aggregate disposer exactly once, detach its listeners, and preserve the original signal's process-exit semantics after cleanup. A repeated termination request MUST NOT run aggregate cleanup a second time.

#### Scenario: A standalone watch command starts
- **WHEN** compile watch, test watch, or preview enters resident supervision directly
- **THEN** its standalone wrapper owns the session signals and terminal while its contribution owns neither

#### Scenario: Start composes child contributions
- **WHEN** start supervises preview and test contributions in one resident session
- **THEN** start owns one signal and terminal boundary and neither child contribution installs another boundary

#### Scenario: Shutdown starts from an attached terminal
- **WHEN** a supported termination request occurs while a child terminal is attached
- **THEN** the root session restores stdin mode and the cursor before waiting for contribution cleanup

#### Scenario: A termination signal is repeated
- **WHEN** another supported termination request arrives after aggregate shutdown has begun
- **THEN** no task, contribution, listener, or command-owned resource is disposed more than once

### Requirement: Contribution disposal owns all contributed resources
Every watch command contribution SHALL expose one `dispose(): Promise<void>` operation as the complete ownership boundary for its contributed resources. The first call SHALL record disposal intent and cache one completion promise; every concurrent or later call SHALL return that same promise. Disposal SHALL attempt to stop every idle, activating, and active logical task created by the contribution before attempting to detach contribution listeners and release all auxiliary resources. A failure from one task or cleanup stage MUST NOT prevent the remaining owned cleanup attempts. Disposal SHALL settle only after every attempt finishes and SHALL reject with the combined cleanup failure when any attempt fails. A root supervisor MUST delegate contributed task cleanup to that operation and MUST NOT independently stop the same tasks. Programmatic disposal SHALL remain available for partial startup rollback, composition, lazy-activation races, tests, and callers that release a contribution without terminating their host process.

#### Scenario: A contribution is disposed directly
- **WHEN** a composed caller no longer needs a prepared contribution
- **THEN** one call to `dispose()` stops all of its tasks and releases all contribution-owned listeners and auxiliary resources without sending a process signal

#### Scenario: Contribution disposal is repeated
- **WHEN** command rollback, supervision cleanup, and a caller `finally` block request disposal of the same contribution
- **THEN** the contribution performs its cleanup once and every caller receives the same promise and observes the same completion or failure

#### Scenario: One contributed cleanup fails
- **WHEN** one task stop, listener detachment, or auxiliary-resource cleanup rejects during contribution disposal
- **THEN** disposal attempts every remaining owned cleanup and rejects with the combined cleanup failure only after all attempts settle

#### Scenario: Disposal races with deferred activation
- **WHEN** a contribution is disposed while one of its deferred logical tasks is idle or activating
- **THEN** the task does not start solely because of disposal and no worker created by the race survives

#### Scenario: Root supervision ends
- **WHEN** a root session receives a supported termination signal
- **THEN** it invokes aggregate contribution disposal instead of separately stopping the contributed task list

### Requirement: Logical tasks expose one bounded termination operation
A logical vendor task SHALL expose one idempotent caller-facing stop operation for all activation states. Stopping an idle task MUST settle it without constructing a worker. Stopping an activating or active task SHALL request the runner's private graceful shutdown, wait for worker exit for a bounded internal interval, and force-terminate a worker that does not exit within that interval. Collection cleanup SHALL request task stops concurrently, wait for every task stop to settle, and surface the combined failure only after every task has received its bounded stop attempt. Separate forced-termination operations, worker-exit promises, and timeout policy MUST NOT be required as part of the command-facing task contract.

#### Scenario: An idle task is stopped
- **WHEN** contribution disposal stops a deferred task before activation
- **THEN** the task settles as stopped without importing its execution target or constructing a worker

#### Scenario: An active task stops normally
- **WHEN** contribution disposal stops an active worker whose vendor cleanup completes within the grace interval
- **THEN** the vendor cleanup hook runs once and the worker exits without forced termination

#### Scenario: A vendor cleanup hook hangs
- **WHEN** an active worker does not exit within the internal graceful-stop interval
- **THEN** the task force-terminates that worker within a second bounded interval and aggregate disposal continues

#### Scenario: One task stop rejects
- **WHEN** one task rejects its bounded stop operation while other logical tasks remain active
- **THEN** collection cleanup still requests and awaits every other task stop before surfacing the combined failure

#### Scenario: Stop races with task activation
- **WHEN** a deferred task begins activation concurrently with its idempotent stop operation
- **THEN** stop intent prevents the created runner from surviving and repeated stop calls do not start another cleanup sequence

### Requirement: Runner shutdown is private to the execution boundary
The built-in runner shutdown request SHALL remain private control traffic and MUST NOT be delivered through `VendorRuntime.onMessage()`. That application message channel SHALL contain only service-defined parent messages. On private graceful shutdown, the inline runner or worker entry SHALL invoke the optional stop hook returned by the vendor at most once before settling runner exit; forced termination MAY bypass an incomplete hook after the bounded grace interval.

#### Scenario: A worker-backed vendor is stopped
- **WHEN** its logical task requests graceful shutdown
- **THEN** the worker entry invokes the returned vendor stop hook once without also delivering a shutdown application message

#### Scenario: An application message is posted
- **WHEN** a command sends a service-defined input message to a running vendor
- **THEN** `VendorRuntime.onMessage()` receives that message without exposing runner lifecycle control types

#### Scenario: A vendor returns no stop hook
- **WHEN** a task stops a vendor that owns no resident cleanup resource
- **THEN** the runner exits normally without requiring the vendor to handle a built-in shutdown message
