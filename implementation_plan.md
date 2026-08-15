# Fix Initial Workspace Snapshot and Synchronization

## Goal

Resolve the bug where User B does not receive the current workspace files from User A upon joining a CoForge collaboration session, and correctly handle pathing and synchronization loops.

## Open Questions

None. The user has provided precise instructions.

## Proposed Changes

### `src/collaboration/session/SessionManager.ts`

- Add `[SNAPSHOT DEBUG]` logs as requested.
- Change the `joinSession` method to instantiate `WorkspaceSyncService` *before* applying the snapshot, and populate `addRemoteApplyGuard` for all snapshot files. This suppresses `FILE_CREATED` / `FILE_CHANGED` loops exactly as requested, while still materializing the files into the guest workspace correctly.

### `server/src/server.ts`

- Add `[SNAPSHOT DEBUG]` logs to `handleRequestWorkspaceSnapshot` and `handleWorkspaceSnapshot`.

### `src/workspace/WorkspaceSnapshotService.ts`

- Use `vscode.workspace.asRelativePath(uri, false)` instead of `path.relative(...)` to guarantee paths are purely workspace-relative without case-insensitivity drive letter issues on Windows.
- Add `[SNAPSHOT DEBUG]` logs.

### `src/workspace/WorkspaceSyncService.ts`

- Use `vscode.workspace.asRelativePath(uri, false)` instead of `path.relative(...)` to avoid absolute paths escaping.

### `src/commands/JoinCollaborationCommand.ts`

- Change the empty workspace warning message to exactly `"CoForge: Please open a workspace folder before joining a collaboration session."` as requested.
- Ensure the message is shown as an error message if it's missing, rather than a warning message, or as requested.

## Verification Plan

### Automated Tests
Run tests with `npm run compile`.

### Manual Verification
As instructed in Step 10: Run the extension in two VS Code instances. Host creates a workspace with `hello.txt`, `README.md`, `src/main.js`. Client opens an empty workspace and joins. Observe files materializing. Test two-way live edits and file deletions.
