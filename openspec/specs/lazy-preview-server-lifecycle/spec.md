## Purpose

Define opt-in request-triggered preview activation, deterministic port ownership, failure isolation, observable lifecycle state, and coordinated shutdown.

## Requirements

### Requirement: Lazy preview execution is opt-in
The `preview` and `start` commands SHALL accept a boolean `--lazy` option that defers preview vendor execution while retaining eager workspace resolution and preview input preparation. Without `--lazy`, every successfully prepared preview logical task SHALL activate immediately and preserve existing eager behavior. With `--lazy`, successfully prepared preview logical tasks SHALL remain idle until preview traffic activates them. `start --lazy` MUST NOT defer configured test watch tasks.

#### Scenario: Standalone preview uses lazy execution
- **WHEN** a user runs `bit-lite preview --lazy` with several successfully prepared preview envs
- **THEN** the command keeps one idle logical preview task per env without starting their workers or dev servers

#### Scenario: Start keeps tests eager
- **WHEN** a user runs `bit-lite start --lazy` for an env with preview and test services
- **THEN** the preview logical task remains idle while the test watch task starts immediately

#### Scenario: Lazy option is omitted
- **WHEN** a user runs `preview` or `start` without `--lazy`
- **THEN** every successfully prepared preview logical task activates immediately with the existing public preview behavior

### Requirement: Any registered env traffic activates its preview
The public preview route for every successfully prepared env SHALL be registered before that env has an upstream server. Any HTTP request or WebSocket upgrade whose path is in a known `/env/<encoded-env>/...` namespace SHALL activate the env when idle, await an activation already in progress, and forward the original traffic unchanged after a routable server becomes ready. Traffic outside a known env namespace MUST NOT activate a preview task.

#### Scenario: Direct child asset activates an idle env
- **WHEN** the first request for an idle env addresses a JavaScript, stylesheet, image, or other child path under that env namespace
- **THEN** the command activates the env and forwards that same request after the server becomes ready

#### Scenario: WebSocket upgrade activates an idle env
- **WHEN** the first traffic for an idle env is a WebSocket upgrade under that env namespace
- **THEN** the command activates the env and forwards the upgrade after the server becomes ready

#### Scenario: Presentation traffic does not activate envs
- **WHEN** a client reads the standalone root, combined start root, manifest, test route, or an unknown env namespace
- **THEN** no idle preview env is activated by that request

#### Scenario: Triggering client disconnects
- **WHEN** a request disconnects after it has initiated a shared env activation
- **THEN** the activation continues for other waiters and subsequent traffic rather than being cancelled solely for that disconnection

### Requirement: Preview activation is coalesced and single-use
Each prepared preview env SHALL own one stable logical task and at most one activation promise. Concurrent activation attempts MUST share that promise and MUST NOT create duplicate workers or dev servers. A successful activation SHALL remain active until command shutdown. A failed activation SHALL retain one controlled failure and MUST NOT automatically spawn another worker on later requests.

#### Scenario: Concurrent cold requests arrive
- **WHEN** multiple HTTP requests or upgrades reach one idle env before its vendor becomes ready
- **THEN** exactly one worker and dev server start and every request awaits the same activation result

#### Scenario: Activated env is requested again
- **WHEN** traffic reaches an env whose actual upstream server is already ready
- **THEN** the proxy forwards it without invoking activation again

#### Scenario: Activation fails
- **WHEN** an env's worker, vendor, port binding, compiler, or result validation fails during activation
- **THEN** that env becomes failed with a useful reason, concurrent waiters receive the same failure, and independent envs and test tasks continue running

#### Scenario: Failed env is requested again
- **WHEN** later traffic reaches an env whose activation has already failed
- **THEN** the proxy returns the controlled failed-env response without automatically creating another worker

### Requirement: Preferred ports are deterministic and actual ports are vendor-produced
For `N` successfully prepared preview envs sorted by canonical selected-env key and internal base port `P`, the parent SHALL assign env index `i` the preferred port `P + i` and SHALL assign every env the fallback start port `P + N`. The parent MUST validate that the preferred range is representable, MUST NOT probe or bind an internal preview port during preparation, and MUST NOT publish an upstream target before receiving a valid actual port from the vendor. A preview vendor SHALL first attempt its own preferred port, SHALL skip the full preferred range when that port is unavailable, SHALL retry bind availability conflicts from the fallback start port through the valid port range, and SHALL return the actual bound port as produced result data.

#### Scenario: Every preferred port is available
- **WHEN** envs activate and each deterministic preferred port can be bound
- **THEN** every vendor uses and reports its own preferred port

#### Scenario: Preferred port is occupied
- **WHEN** a vendor cannot bind its preferred port because that port is unavailable
- **THEN** it searches from the shared fallback start without consuming another idle env's preferred port and reports the port it actually bound

#### Scenario: Fallback vendors race
- **WHEN** multiple vendors concurrently search the fallback range
- **THEN** atomic bind attempts select distinct actual ports and each conflicting attempt continues to another candidate

#### Scenario: Actual port is invalid
- **WHEN** a preview vendor reports no actual port or a value that is not an integer between 1 and 65535
- **THEN** the parent rejects the result, leaves the env without an upstream target, and exposes a vendor contract failure

#### Scenario: Port range cannot be represented
- **WHEN** the internal base and prepared env count would place a preferred port beyond 65535 or no fallback port can be bound
- **THEN** the affected command or activation fails clearly without wrapping, reusing a preferred port, or publishing an invalid route target

### Requirement: Lazy state and shutdown preserve resource ownership
A successfully prepared lazy env SHALL expose complete prepared component navigation while projecting `idle` with no server, SHALL project `starting` during activation, and SHALL project `ready` with its validated actual server only after activation succeeds. Coordinated shutdown SHALL stop idle, activating, and ready logical tasks idempotently before prepared-file disposal and proxy closure. Stopping an idle task MUST NOT create a worker.

#### Scenario: Manifest is read before access
- **WHEN** a lazy env has been prepared but never requested
- **THEN** its manifest entry contains its prepared component links, reports `idle`, and omits actual server information

#### Scenario: Idle command shuts down
- **WHEN** standalone preview or start stops before an idle preview env is accessed
- **THEN** the logical task stops and its prepared files are removed without creating a worker or dev server

#### Scenario: Shutdown races with activation
- **WHEN** coordinated shutdown begins while an env is activating
- **THEN** no upstream is published after disposal and any runner created by the race is stopped or terminated through the same task lifecycle

#### Scenario: Ready command shuts down
- **WHEN** coordinated shutdown begins after one or more lazy envs became ready
- **THEN** every active vendor server stops before prepared files and the central proxy are disposed
