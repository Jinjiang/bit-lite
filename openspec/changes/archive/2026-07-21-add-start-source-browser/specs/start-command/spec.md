## ADDED Requirements

### Requirement: Start serves a live source browser for selected components
While `bit-lite start` is running, start SHALL expose `/source?component=<component-id>` as a source-browser page, `/__bit-lite/source-files.json?component=<component-id>` as that component's current file index, and `/__bit-lite/source-file.json?component=<component-id>&path=<relative-posix-path>` as one current file snapshot. The source catalog MUST be built from the same canonical filtered component selection supplied to preview and test contributions. The index MUST identify the component and its component-relative main file and MUST return deterministically sorted component-relative POSIX file paths and sizes without exposing absolute filesystem paths.

#### Scenario: User opens a component source link
- **WHEN** the user follows a source link for a selected component
- **THEN** the source page loads that component's current file index
- **AND** it initially selects the component's main file when that file is available

#### Scenario: User selects a text source file
- **WHEN** the user selects an indexed UTF-8 text file at or below the content limit
- **THEN** the file route returns the current complete content together with the component ID, relative path, size, `text` kind, and UTF-8 encoding
- **AND** the page renders the path and content as text rather than executable HTML

#### Scenario: Files change while start remains running
- **WHEN** a selected component file is edited, added, or removed after start has launched
- **THEN** a subsequent index or content request reflects the current filesystem state without restarting start
- **AND** a removed requested file produces a controlled unavailable response rather than stale content

#### Scenario: Source page navigation is preserved
- **WHEN** the user chooses a nested file and then reloads or uses browser back and forward navigation
- **THEN** the source page uses its `path` query parameter to restore the requested component-relative file selection when it remains available

### Requirement: Start source routes enforce a bounded component boundary
Start SHALL resolve component IDs only through its canonical selected-component source catalog and SHALL resolve file paths only through a freshly enumerated safe index for that component. Enumeration MUST prune `.git`, `.bit-lite`, `node_modules`, `dist`, `build`, and `coverage` directories at every depth and MUST NOT list or traverse symbolic links. A content read MUST revalidate that the opened entry is a regular non-symbolic-link file whose real path remains within the selected component's real root. Source routes MUST NOT accept writes, execute content, expose arbitrary workspace paths, or reveal absolute paths in successful or error responses.

#### Scenario: An unselected component is requested
- **WHEN** a request names a workspace component excluded by the current component filters or an unknown component ID
- **THEN** the source page and data routes return a controlled not-found response
- **AND** they do not read from that component's root

#### Scenario: A path attempts to escape the component
- **WHEN** a file request supplies an absolute path, backslash path, traversal segment, non-indexed path, or path through a symbolic link
- **THEN** start rejects the request without returning file content or filesystem location details

#### Scenario: Ignored and linked entries are indexed
- **WHEN** a selected component contains a pruned directory or a symbolic-link file or directory
- **THEN** the file index omits that entry and every descendant reachable only through it

#### Scenario: A text file exceeds the content limit
- **WHEN** an indexed regular file exceeds 1,048,576 bytes
- **THEN** the content route returns a successful `too-large` state with the limit and file metadata
- **AND** it returns no full or partial file content

#### Scenario: A file is not valid UTF-8 text
- **WHEN** an indexed file is invalid UTF-8 or contains NUL data within the bounded read
- **THEN** the content route returns a successful `binary` state with file metadata and no content

#### Scenario: A source route receives a write method
- **WHEN** a client sends a non-GET request to a source page or data route
- **THEN** start returns method-not-allowed with `Allow: GET`
- **AND** no filesystem state changes

#### Scenario: A source request is incomplete
- **WHEN** a source request omits a required component or file-path query parameter
- **THEN** start returns a controlled bad-request response without a raw filesystem error

## MODIFIED Requirements

### Requirement: Start exposes combined preview and test navigation
The start root page and manifest SHALL describe the central proxy, selected service tasks with structured env identity, and selected canonical components. For every component in the combined start manifest, the manifest SHALL include a source-browser route and the root UI SHALL expose its `source` link. For each component with preview content, the UI SHALL expose its available overview, docs, and composition links; for each component bound to a started test task, the UI SHALL expose a link to that component's read-only test page.

#### Scenario: Component has preview and test services
- **WHEN** the start UI renders a component whose env configures both services
- **THEN** the component exposes its source link, available preview links, and test-results link

#### Scenario: Component has no configured test service
- **WHEN** the start UI renders a component whose env has no test service
- **THEN** it exposes the component's source link
- **AND** it does not expose an actionable test-results link for that component

#### Scenario: Component has no available preview content
- **WHEN** the start UI renders a selected component whose preview is unavailable or contains no prepared preview entry
- **THEN** it still exposes the component's source link
- **AND** it does not invent overview, docs, or composition links

#### Scenario: Source route is encoded in the manifest
- **WHEN** a component ID contains `/`, spaces, or other URL-significant characters
- **THEN** the manifest source route preserves the exact component ID through URL query encoding
- **AND** following the route resolves the selected component rather than a path segment

#### Scenario: Task state changes after startup
- **WHEN** a child task reports a new status, preview server, or test result
- **THEN** subsequent manifest or result reads expose the latest observed state without restarting the central server
