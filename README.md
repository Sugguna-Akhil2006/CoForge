# CoForge

> Collaborative coding and workspace synchronization directly inside Visual Studio Code.

CoForge lets developers create and join shared VS Code collaboration sessions, synchronize workspace changes, and coordinate saved document versions with other collaborators.

Marketplace: [https://marketplace.visualstudio.com/items?itemName=coforge.coforge](https://marketplace.visualstudio.com/items?itemName=coforge.coforge)  
GitHub: [https://github.com/Sugguna-Akhil2006/CoForge](https://github.com/Sugguna-Akhil2006/CoForge)  
Next Release: v1.0.8  
Production WebSocket server: wss://coforge.onrender.com

## Features

### Collaboration Sessions
Create and join collaboration sessions using a unique session ID.

### Workspace Synchronization
Collaborators can synchronize the shared workspace state.

### Save-Based Document Synchronization
Document editing remains local while users type.
A successful save becomes a collaboration event.

### First-Save-Wins
The server uses document revisions.
If multiple users are editing the same revision:
the first valid save is accepted.
Subsequent stale saves are rejected.

### File Management
Support:
- file creation
- file deletion
- file rename

### WebSocket Communication
CoForge uses WebSockets for collaboration/session communication.

### Reconnection
Clients can reconnect and synchronize with the latest accepted workspace/document state.

### VS Code Integration
CoForge works directly through the VS Code Command Palette.

## How synchronization works

CoForge intentionally does not synchronize every keystroke between users.

Each collaborator can edit their local copy independently.

When a user saves, CoForge sends the saved document version to the collaboration server.

The server checks the document revision.

If the save is based on the current revision, it is accepted and becomes the new collaborative version.

If another collaborator has already saved a newer revision, the stale save is rejected.

```text
User A edits ─────── LOCAL
User B edits ─────── LOCAL

        User A presses Save
                 │
                 ▼
          CoForge Server
                 │
          Revision Check
                 │
          ┌──────┴──────┐
          ▼             ▼
       ACCEPT         REJECT
          │             │
          ▼             ▼
   New revision     Stale revision
          │
          ▼
   Collaborators
   receive version
```

# How to Use CoForge

START → SHARE SESSION ID → JOIN → COLLABORATE → SAVE → STOP

## Start a Collaboration Session

### 1. Open your project
Open the workspace/project you want to collaborate on in VS Code.

### 2. Open Command Palette
Press:
`Ctrl + Shift + P`

### 3. Start CoForge
Search for:
`CoForge: Start Collaboration`

Select it.

CoForge creates a collaboration session.

You will receive a unique session ID.

Example:
`dcc4ca4e-26ba-4269-833e-318f9c2f4633`

IMPORTANT:
This is only an example.
Your actual session ID will be different.

### 4. Share the Session ID
Copy the session ID and send it to your teammate.

Example:

Host:
`CoForge: Start Collaboration`
↓
Session ID:
`YOUR-SESSION-ID`
↓
Send the ID to your teammate.

## Join a Collaboration Session

### 1. Open the project/workspace
Open VS Code on the collaborator's computer.

### 2. Open Command Palette
Press:
`Ctrl + Shift + P`

### 3. Join CoForge
Search:
`CoForge: Join Collaboration`

Select it.

### 4. Enter the Session ID
Enter the session ID provided by the host.

Example:
`YOUR-SESSION-ID`

### 5. Connect
Once connected, CoForge synchronizes the collaboration/workspace state.

The collaborator can now work in the shared session.

## Collaborative Editing

Typing is local.

CoForge does not broadcast every keystroke.

This allows each developer to work normally without cursor jumping or live-edit conflicts.

When you are ready to publish your changes to the collaboration session, save the file.

Example:

User A edits:
`main.ts`

User B edits:
`main.ts`

Both can work independently.

When A saves first:
A's saved version becomes the accepted version.
B receives the accepted version.

If B tries to save an older revision afterward:
CoForge rejects the stale save.

## First-Save-Wins

Initial revision:
10

User A edits locally.
User B edits locally.
Both are based on revision 10.

A saves:
SAVE revision 10

Server:
10 == current revision
ACCEPT

Current revision becomes:
11

B then tries:
SAVE revision 10

Server:
10 != current revision 11
REJECT

B receives the current revision 11.

This prevents stale edits from overwriting an already accepted collaborative version.

## Stop Collaboration

### 1. Open Command Palette
Press:
`Ctrl + Shift + P`

### 2. Search:
`CoForge: Stop Collaboration`

### 3. Select the command
Stops the local client's active collaboration connection.

## Command Reference

| Command | Description |
|---|---|
| CoForge: Start Collaboration | Create a new collaboration session |
| CoForge: Join Collaboration | Join an existing session using a session ID |
| CoForge: Stop Collaboration | Stop the local collaboration connection |
| CoForge: Request Workspace Snapshot | Request the current workspace snapshot |

## Quick Start

Host:
1. Open VS Code.
2. Open Command Palette.
3. Run `CoForge: Start Collaboration`.
4. Copy the session ID.
5. Share it with your teammate.

Collaborator:
1. Open VS Code.
2. Open Command Palette.
3. Run `CoForge: Join Collaboration`.
4. Enter the session ID.
5. Start collaborating.

Finish:
1. Open Command Palette.
2. Run `CoForge: Stop Collaboration`.

## Architecture

```text
VS Code
   │
   ▼
CoForge Extension
   │
   ▼
WebSocket
   │
   ▼
CoForge Collaboration Server
   │
   ├── Sessions
   ├── Workspace State
   ├── Document Revisions
   └── Save Conflict Handling
   │
   ▼
Collaborating VS Code Clients
```

Document save flow:
```text
VS Code Save
     │
     ▼
SAVE_DOCUMENT
     │
     ▼
Server Revision Check
     │
 ┌───┴────┐
 ▼        ▼
ACCEPT   STALE
 │        │
 ▼        ▼
New      Reject
Revision + Current Version
 │
 ▼
Collaborators
```

## Tech Stack

- TypeScript
- VS Code Extension API
- Node.js
- WebSocket (`ws`)
- Jest

## Testing

8 test suites passed — 78 tests passed.

## Development

Install:
```bash
npm install
```

Compile:
```bash
npm run compile
```

Test:
```bash
npm test
```

Package:
```bash
vsce package
```

Server:
```bash
cd server
npm install
npm run dev
```

Production server build:
```bash
cd server
npm run build
npm start
```

## Project Structure

```
src/
server/
test/
package.json
README.md
```

## Known Limitations

### Save-Based Synchronization
CoForge intentionally uses save-based synchronization rather than per-keystroke live synchronization.
Unsaved changes remain local until the user saves.

### First-Save-Wins
If multiple collaborators edit the same document revision, the first valid save is accepted. Later stale saves are rejected.

### Persistence
Collaborative save behavior is currently designed around VS Code's save lifecycle.

## Roadmap

- improved collaborative persistence
- improved stale-save conflict UX
- user presence
- cursor/selection indicators
- authentication
- workspace permissions
- persistent collaboration sessions

## Changelog

### v1.0.8
- Replaced unstable per-keystroke live text synchronization with save-based synchronization
- Added first-save-wins document revision handling
- Added stale-save rejection
- Improved collaborative document consistency
- Improved collaboration stability
- Updated documentation with Start, Join and Stop workflows
- Updated testing and synchronization documentation
