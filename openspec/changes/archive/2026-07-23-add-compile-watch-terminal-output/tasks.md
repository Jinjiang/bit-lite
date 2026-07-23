## 1. Maintained compiler watch output

- [x] 1.1 Add concise component-identified attempt-start and successful-completion `console.log` output to the shared maintained compiler watch helper
- [x] 1.2 Format compile failures once, write their full component-identified diagnostics with `console.error`, and retain the existing structured error plus watcher recovery behavior
- [x] 1.3 Write component-identified watcher-level diagnostics to stderr while retaining the existing structured watcher error behavior

## 2. Output and recovery coverage

- [x] 2.1 Extend maintained compiler lifecycle tests to cover initial and rebuild progress/success output, component identity, structured results, and unchanged one-shot output
- [x] 2.2 Add a failed-rebuild and correction test that verifies full stderr diagnostics, no false success output, structured task errors, watcher continuity, and a later successful result
- [x] 2.3 Cover watcher-level stderr plus structured errors and verify worker-backed compile watch stdout/stderr reaches the task raw-output buffer for late terminal replay

## 3. Verification

- [x] 3.1 Run the focused `demo-vendors` compiler watch tests and `bit-lite` compile command tests with pnpm
- [x] 3.2 Run the `demo-vendors` and `bit-lite` type checks and validate the completed OpenSpec change
