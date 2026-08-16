# CoForge

> Collaborative coding directly inside Visual Studio Code.

Start a session. Share the ID. Code together.

Marketplace: [https://marketplace.visualstudio.com/items?itemName=coforge.coforge](https://marketplace.visualstudio.com/items?itemName=coforge.coforge)  
GitHub: [https://github.com/Sugguna-Akhil2006/CoForge](https://github.com/Sugguna-Akhil2006/CoForge)  
Current version: v1.0.7  
Production server: wss://coforge.onrender.com

## Features

### Collaboration Sessions
Users can create and join collaboration sessions using a unique session ID.

### Live Collaborative Editing
CoForge uses Yjs to synchronize document changes between collaborators. Users can edit the same file simultaneously. Changes propagate without requiring users to press Save.

### Concurrent Editing
Multiple users can edit the same document at the same time. Normal text editing is NOT blocked simply because another user is editing the file.

### Workspace Snapshots
Joining users can receive the workspace state from the active collaboration session.

### File Management
Support:
- create
- delete
- rename

### Reconnection
Clients can reconnect and synchronize with the collaboration session.

### WebSocket Communication
Production endpoint:
`wss://coforge.onrender.com`

## Yjs Architecture

VS Code A
    │
    ▼
TextDocument
    │
    ▼
Yjs Y.Text
    │
    ▼
WebSocket
    │
    ▼
CoForge Server
    │
    ▼
WebSocket
    │
    ▼
Yjs Y.Text
    │
    ▼
TextDocument
    │
    ▼
VS Code B

Yjs is used to maintain collaborative document state and merge concurrent updates. 

## Live Editing Example

User A:
```javascript
const hello = "world";
```
while User B can simultaneously edit the same file.

Changes are synchronized while typing; saving is not required for collaborators to receive edits.

## Current Limitation
CoForge's collaborative editing layer synchronizes live document changes using Yjs. However, persistence to the local filesystem still follows VS Code's normal save lifecycle.

If multiple users make concurrent edits and save independently, the latest save can determine the persisted disk version.

Collaborative persistence and deterministic save convergence are planned for a future release.

## Testing

Automated tests:
- 82 passed
- 0 failed

Test suites:
- 9 passed
- 0 failed

Tests cover areas including:
- WebSocket client
- VS Code adapter
- protocol
- collaboration behavior
- synchronization

## Usage

### User A
Open a workspace.
Run:
`CoForge: Start Collaboration`
Copy the generated session ID.

### User B
Open VS Code.
Run:
`CoForge: Join Collaboration`
Enter the session ID.

Both users can then work in the shared collaboration session.

## Development

```bash
npm install
npm run compile
npm test
```
Expected: 82 tests passing.

Server development:
```bash
cd server
npm install
npm run dev
```

Production build:
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
icon.png
```

## Release Information

CoForge v1.0.7

### Changelog (v1.0.7)
- Added Yjs-based collaborative document synchronization
- Added simultaneous same-file editing
- Improved live editing experience
- Removed normal editing restrictions caused by file locking
- Improved collaboration synchronization
- Improved reconnection handling
- Added/updated synchronization tests
- 82 automated tests passing

Known limitation:
- Save/persistence convergence remains a future improvement

## Roadmap

### Completed
- Session creation
- Session joining
- Workspace sharing
- WebSocket collaboration
- Yjs live synchronization
- Concurrent editing
- File management
- Reconnection
- Automated testing

### Next
- Collaborative save convergence
- Canonical persistence
- Better external file change handling
- Cursor/selection presence
- User presence indicators
- Better conflict visualization

### Future
- Persistent sessions
- Authentication
- Workspace permissions
- Advanced collaboration controls
