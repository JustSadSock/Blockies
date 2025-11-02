# 🎮 Blockies 🎮

A modern multiplayer Tetris-like game with single-player, local co-op, and online multiplayer support.

## Features

- ✨ **Single-player mode** - Play classic Tetris alone
- 👥 **Local multiplayer** - Play with up to 4 players on the same computer
- 🌐 **Online multiplayer** - Play with friends over the network
- ⌨️ **Customizable controls** - Configure key bindings for each player
- 🎨 **Custom colors** - Choose your own block colors
- 💝 **Beautiful design** - Stunning gradient interface with smooth animations
- 📱 **Mobile-friendly** - Touch controls and responsive design

## How to Play

### Single Player
1. Open `index.html` in your web browser
2. Click "Single Player"
3. Use arrow keys to play:
   - **↑** - Rotate
   - **↓** - Move down
   - **← →** - Move left/right
   - **Space** - Hard drop

### Local Co-op
1. Click "Local Co-op"
2. Select number of players (1-4)
3. Configure controls and colors for each player
4. Click "Start Game"

Default controls:
- **Player 1**: Arrow keys (↑ to rotate, ↓ to move down, ← → to move left/right, Space for hard drop)
- **Player 2**: WASD (W to rotate, S to move down, A/D to move left/right, Q for hard drop)
- **Player 3**: IJKL (I to rotate, K to move down, J/L to move left/right, U for hard drop)
- **Player 4**: TFGH (T to rotate, G to move down, F/H to move left/right, R for hard drop)

### Online Multiplayer
1. Click "Online"
2. Create a room or join an existing one
3. Select your color (colors must be unique)
4. Click "Ready" when you're ready to play
5. Game starts when all players are ready

For server setup, see [SERVER_README.md](SERVER_README.md)

## Controls

- **ESC** - Pause/Resume game
- **Pause button** (in header) - Pause/Resume
- **Menu button** (in header) - Return to main menu

## Game Rules

- Clear lines by filling them completely with blocks
- The more lines you clear at once, the more points you score
- The game speeds up as you progress through levels
- In multiplayer, all players share the same board
- Game ends when pieces reach the top

## Mobile Support

- Touch controls automatically appear on mobile devices
- Double-tap zoom is disabled for better gameplay
- Optimized layout for mobile screens

## Settings

Click the "Settings" button to:
- Change block colors for each player
- Customize key bindings for each player
- Configure gamepad assignments (if gamepads are connected)
- Settings are saved automatically in your browser

## Technologies

- Pure HTML5, CSS3, and JavaScript
- Socket.io for real-time multiplayer
- Node.js/Express for server
- No external dependencies for single-player
- Works in all modern browsers

## Running Locally

### For Single Player and Local Co-op
Just open `index.html` in your web browser. No server needed!

### For Online Multiplayer
1. Install Node.js from https://nodejs.org/
2. Install dependencies: `npm install`
3. Start the server: `npm start`
4. Open `http://localhost:3000` in your browser

For production deployment with Cloudflared tunnel, see [SERVER_README.md](SERVER_README.md)

Enjoy playing Blockies! 🎉