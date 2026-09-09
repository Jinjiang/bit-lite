# bit-lite-versioning

`bit-lite-versioning` turns workspace state into recorded component content, and
turns two recorded states into an account of what changed between them.

It sits between the base workspace model and the component store because it is
the only layer that needs both: `bit-lite-context` describes components without
knowing they have history, and `bit-lite-history` stores content without knowing
what a workspace is.

Producing and comparing live here together on purpose. A component's recorded
form is defined once, and both directions use that definition — which is what
makes `status` report a component as modified exactly when recording it would
act on it. Split across two packages, the shared definition would become a
dependency either side could replace.

It declares no dependency on env resolution, so recording and inspection stay
independent of whether anything has been installed.
