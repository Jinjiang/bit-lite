export {
  assertLinearComponentHistory,
  buildCommitMessage,
  createComponentCommit,
  readComponentCommit,
  readComponentHead,
} from "./commits.js";
export {
  abbreviateComponentVersion,
  assertNotSnapVersion,
  formatSnapVersion,
  isSnapVersion,
  parseSnapVersion,
} from "./component-version.js";
export { ComponentHistoryError, GitCommandError } from "./errors.js";
export {
  compareTrees,
  readComponentHistory,
  readTreeFile,
  readTreeFiles,
  readVersionsBySnap,
} from "./inspect.js";
export { createGitRunner, defaultMaxOutputBytes, runGitLine } from "./git-process.js";
export {
  computeSnapshotBlobs,
  computeSnapshotTree,
  readCommitTree,
  writeSnapshotBlobs,
  writeSnapshotTree,
} from "./objects.js";
export { computeSnapshotTreeId } from "./tree-id.js";
export {
  createObjectId,
  formatObjectId,
  getObjectIdHexLength,
  isGitObjectAlgorithm,
  isNullObjectId,
  nullObjectId,
  objectIdsEqual,
  parseObjectId,
} from "./object-id.js";
export { describeRefUpdate, updateRefsAtomically } from "./ref-transaction.js";
export {
  componentHeadFetchRefspec,
  componentHeadRef,
  componentHeadRefPrefix,
  componentTagFetchRefspec,
  componentTagRef,
  componentTagRefPrefix,
  decodeComponentKey,
  encodeComponentKey,
  parseComponentHeadRef,
  parseComponentTagRef,
  parseRemoteComponentHeadRef,
  parseRemoteComponentTagRef,
  remoteComponentHeadRef,
  remoteComponentTagRef,
  remoteTrackingRefPrefix,
} from "./refs.js";
export { defaultRemoteName, readStoreRemoteUrl, resolveStoreRemote } from "./remote.js";
export {
  describeComponentSnaps,
  prepareComponentSnap,
  publishComponentSnaps,
  snapComponents,
} from "./snap.js";
export { syncComponentHistory } from "./sync.js";
export { prunedDirectoryNames, readComponentSnapshot } from "./snapshot.js";
export {
  checkGitAvailability,
  componentStoreDirectoryName,
  openComponentHistoryStore,
  resolveComponentStorePath,
} from "./store.js";
export {
  assertAnnotatedTag,
  assertComponentVersion,
  deriveNextComponentVersion,
  listComponentVersionRefs,
  listComponentVersions,
  readVersionAtSnap,
  assertTagTargetsComponent,
  assertValidComponentTag,
  readTagTarget,
  tagComponent,
} from "./tags.js";

export type { ComponentCommit, CreateComponentCommitInput } from "./commits.js";
export type {
  ComponentHistoryEntry,
  FileChange,
  FileChangeStatus,
  TreeFileEntry,
} from "./inspect.js";
export type {
  CreateGitRunnerOptions,
  GitCommandInput,
  GitCommandResult,
  GitRunner,
} from "./git-process.js";
export type { GitObjectAlgorithm, GitObjectId } from "./object-id.js";
export type { RefUpdate } from "./ref-transaction.js";
export type { ParsedComponentHeadRef, ParsedComponentTagRef } from "./refs.js";
export type { ResolveStoreRemoteInput } from "./remote.js";
export type {
  ComponentHeadSyncResult,
  ComponentTagSyncResult,
  SyncOptions,
  SyncOutcome,
  SyncResult,
} from "./sync.js";
export type {
  ComponentSnapResult,
  ComponentSnapStatus,
  PreparedComponentSnap,
  SnapRequest,
  SnapResult,
} from "./snap.js";
export type {
  ComponentFileEntry,
  ComponentFileMode,
  ComponentSnapshot,
  ReadComponentSnapshotInput,
} from "./snapshot.js";
export type {
  ComponentHistoryStore,
  GitAvailability,
  OpenComponentHistoryStoreOptions,
} from "./store.js";
export type { ComponentTagResult, ComponentTagStatus, ComponentVersionRef } from "./tags.js";
