# CoForge

CoForge is a Visual Studio Code collaboration extension that allows developers to collaborate on the same workspace using session-based collaboration, workspace synchronization, per-file editing locks, and controlled save-based synchronization.

Marketplace: [https://marketplace.visualstudio.com/items?itemName=coforge.coforge](https://marketplace.visualstudio.com/items?itemName=coforge.coforge)  
GitHub: [https://github.com/Sugguna-Akhil2006/CoForge](https://github.com/Sugguna-Akhil2006/CoForge)  
Production WebSocket server: wss://coforge.onrender.com

## Features

- Session-based collaboration
- Start Collaboration
- Join Collaboration
- Stop Collaboration
- Session ID sharing
- Copy Session ID
- Copy Invite
- Workspace/file synchronization
- Save-based synchronization
- Conflict/revision protection
- Per-file editing locks
- Independent editing of unlocked files
- View locked files
- Run/debug while another user has a file locked
- Automatic lock release when the user moves away from the actively locked file
- Lock cleanup on disconnect
- Stale-lock/heartbeat cleanup
- Multiple collaborators
- VS Code command-palette integration

> **Note**: CoForge intentionally uses save-based synchronization rather than continuously synchronizing every keystroke.

## Start a Collaboration

1. Open the project in VS Code.
2. Press: `Ctrl + Shift + P`
3. Select: `CoForge: Start Collaboration`
4. Follow the prompts.
5. A Collaboration Session ID will be generated.
6. Use **Copy Session ID** or **Copy Invite** to share the session with teammates.

Example:
```text
Session ID:
dcc4ca4e-26ba-4269-833e-318f9c2f4633
```

## Join a Collaboration

1. Open the project in VS Code.
2. Press: `Ctrl + Shift + P`
3. Select: `CoForge: Join Collaboration`
4. Enter the Session ID provided by the host.
5. Complete the join flow.
6. The workspace will synchronize with the active collaboration session.

*Note: You can join with a display name. However, the human-readable name display in the lock UI is currently not fully reliable. In some cases, an internal user ID might be displayed instead.*

## Stop Collaboration

1. Press: `Ctrl + Shift + P`
2. Select: `CoForge: Stop Collaboration`

This disconnects the user from the active collaboration session and releases locks owned by that user.

## File Locking

CoForge features robust, per-file locking:

Example:

Akhil is editing `main.ts`.

That file is locked for other collaborators.
However, other files remain editable:

```text
main.ts      🔒 Locked
utils.ts     🟢 Editable
server.ts    🟢 Editable
README.md    🟢 Editable
```

Other collaborators can:
- View the locked file
- Run/debug the project
- Edit other unlocked files
- Edit the locked file after its lock is released

Locking is strictly PER FILE, not workspace-wide.

## Lock Release

When a collaborator moves away from the file they are actively editing, the file lock is released automatically so another collaborator can work on it.

Locks are also cleaned up when:
- collaboration is stopped
- the user disconnects
- a stale lock expires

## Synchronization

CoForge intentionally does NOT use continuous live keystroke synchronization.

Instead:
1. Collaborator edits a file locally.
2. Collaborator saves the file.
3. CoForge synchronizes the saved version.
4. Other participants receive the updated file.

This design reduces conflicts and avoids the unstable behavior that can occur when multiple people continuously modify the same file.

## Copy Session ID

After starting a collaboration session, use **Copy Session ID** to copy only the session ID to the clipboard.

## Copy Invite

**Copy Invite** creates a ready-to-share collaboration message containing the session information and instructions for joining.

## Commands

| Command | Purpose |
|---|---|
| `CoForge: Start Collaboration` | Create a new collaboration session |
| `CoForge: Join Collaboration` | Join an existing session |
| `CoForge: Stop Collaboration` | Leave the current collaboration session |
| `CoForge: Request Workspace Snapshot` | Request the current workspace state |

## Workflow

**Host:**
Start Collaboration
↓
Receive Session ID
↓
Copy Session ID / Copy Invite
↓
Share with teammates

**Teammate:**
Join Collaboration
↓
Enter Session ID
↓
Synchronize workspace
↓
Edit unlocked files
↓
Save changes
↓
Changes synchronize with collaborators

## Installation

Install from the VS Code Marketplace:
[CoForge Extension](https://marketplace.visualstudio.com/items?itemName=coforge.coforge)

You can also install a local VSIX package:
```bash
code --install-extension .\coforge-1.0.9.vsix --force
```

## Development

Install dependencies:
```bash
npm install
```

Compile the extension:
```bash
npm run compile
```

Run tests:
```bash
npm test
```

## Testing

CoForge includes a comprehensive Jest test suite covering:
- unit tests
- protocol tests
- WebSocket tests
- file locking tests
- display-name tests
- server integration tests

Currently, 10 test suites and 86 tests pass successfully (86/86).

## Architecture

```text
VS Code Extension
        ↓
WebSocket Client
        ↓
CoForge Collaboration Server
        ↓
Session / Participant Management
        ↓
File Lock Management
        ↓
Workspace Synchronization
```

## Important Limitations

- **Save-Based**: Synchronization is save-based, not continuous live typing.
- **Single Editor**: A file can only be actively edited by the collaborator holding its lock.
- **View/Run**: Other collaborators can still view and run locked files.
- **Server Dependency**: Collaboration depends on the configured CoForge server.
- **Display Names**: Display-name presentation is supported but UI reliability may vary in the current build.
