export {
  componentConfigFileName,
  projectComponentConfig,
  projectComponentConfigBytes,
  serializeProjectedComponentConfig,
} from "./component-projection.js";
export {
  createSnapPolicy,
  prepareRecording,
  writeRecordedVersions,
} from "./component-recording.js";
export {
  attributeSnapChange,
  compareComponentMetadata,
  hasMetadataChange,
  readRecordedComponentConfig,
} from "./component-metadata-diff.js";
export {
  compareComponentStates,
  computeProjectedWorkingState,
  inspectWorkspace,
  unrecordedComponentVersion,
} from "./component-inspection.js";
export type {
  ComponentVersionLookup,
  ProjectComponentInput,
  ProjectedComponentConfig,
} from "./component-projection.js";
export type {
  PreparedRecording,
  PrepareRecordingInput,
  RecordingPolicy,
} from "./component-recording.js";
export type {
  ChangeSource,
  DependencyChange,
  DependencyField,
  EnvChange,
  MetadataComparison,
  RecordedComponentConfig,
  SnapAttribution,
} from "./component-metadata-diff.js";
export type {
  ComparisonSide,
  ComponentComparison,
  ComponentWorkingState,
  InspectedComponent,
  WorkspaceInspection,
} from "./component-inspection.js";
export {
  applyVersionExclusions,
  assertVersionDecisions,
  decisionExplicitVersion,
  decisionIncrement,
  decisionNamesVersion,
  noVersionDecisions,
} from "./version-decision.js";
export type { VersionDecision, VersionDecisions } from "./version-decision.js";
