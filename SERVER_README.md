# Blockies Multiplayer Server

## Setup Instructions

### Prerequisites
- Node.js (v14 or higher)
- npm (comes with Node.js)
- Cloudflared (for tunnel setup)

### Installation

1. Install dependencies:
```bash
npm install
```

### Running the Server

#### Option 1: Windows (with Cloudflared tunnel)
Simply run the batch file:
```
start-server.bat
```

This will:
- Install dependencies if needed
- Start the Node.js server on port 3000
- Start the Cloudflared tunnel (irgri-tunnel)
- Make the server accessible at https://irgri.uk

#### Option 2: Manual (any OS)

Start the server manually:
```bash
node server.js
```

The server will run on port 3000 by default.

### Cloudflared Setup

If you need to set up Cloudflared:

1. Download and install Cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/

2. Authenticate with Cloudflare:
```bash
cloudflared tunnel login
```

3. Create a tunnel:
```bash
cloudflared tunnel create irgri-tunnel
```

4. Configure the tunnel to point to localhost:3000

5. Run the tunnel:
```bash
cloudflared tunnel run irgri-tunnel
```

### Environment Variables

- `PORT` - Server port (default: 3000)

## Features

- Room creation and management
- Player color selection (no duplicates)
- Ready status tracking
- Automatic game start when all players are ready
- Real-time game state synchronization
- WebSocket-based communication

## API Events

### Client -> Server
- `create-room` - Create a new room
- `join-room` - Join an existing room
- `leave-room` - Leave current room
- `change-color` - Change player color
- `toggle-ready` - Toggle ready status
- `game-state` - Send game state update
- `player-input` - Send player input

### Server -> Client
- `rooms-list` - List of available rooms
- `room-created` - Room creation confirmed
- `room-joined` - Room join confirmed
- `room-update` - Room state updated
- `left-room` - Left room confirmed
- `game-start` - Game starting
- `game-state` - Game state update from other players
- `player-input` - Player input from other players
- `error` - Error message
