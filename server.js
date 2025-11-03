const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname)));

// Game state
const rooms = new Map();
const players = new Map();

// Available colors for players
const AVAILABLE_COLORS = ['#FF1493', '#00D9FF', '#FFDB58', '#39FF14'];

class Room {
    constructor(id, name, hostId) {
        this.id = id;
        this.name = name;
        this.hostId = hostId;
        this.players = [];
        this.maxPlayers = 4;
        this.gameStarted = false;
        this.usedColors = new Set();
        this.isPrivate = false;
        this.accessCode = null;
        this.currentGame = null;
    }

    addPlayer(playerId, playerName) {
        if (this.players.length >= this.maxPlayers) {
            return false;
        }

        const availableColor = AVAILABLE_COLORS.find(color => !this.usedColors.has(color));
        if (!availableColor) {
            return false;
        }

        this.players.push({
            id: playerId,
            name: playerName,
            color: availableColor,
            ready: false
        });
        this.usedColors.add(availableColor);
        return true;
    }

    removePlayer(playerId) {
        const playerIndex = this.players.findIndex(p => p.id === playerId);
        if (playerIndex !== -1) {
            const player = this.players[playerIndex];
            this.usedColors.delete(player.color);
            this.players.splice(playerIndex, 1);
            
            // If host left, assign new host
            if (this.hostId === playerId && this.players.length > 0) {
                this.hostId = this.players[0].id;
            }
            
            return true;
        }
        return false;
    }

    setPlayerColor(playerId, color) {
        if (this.usedColors.has(color)) {
            return false;
        }

        const player = this.players.find(p => p.id === playerId);
        if (player) {
            this.usedColors.delete(player.color);
            player.color = color;
            this.usedColors.add(color);
            return true;
        }
        return false;
    }

    setPlayerReady(playerId, ready) {
        const player = this.players.find(p => p.id === playerId);
        if (player) {
            player.ready = ready;
            return true;
        }
        return false;
    }

    allPlayersReady() {
        return this.players.length > 0 && this.players.every(p => p.ready);
    }

    beginGame(seed) {
        this.players.forEach(player => {
            player.ready = false;
        });
        this.gameStarted = true;
        this.currentGame = {
            seed,
            startedAt: Date.now()
        };
    }

    resetGameState() {
        this.gameStarted = false;
        this.currentGame = null;
        this.players.forEach(player => {
            player.ready = false;
        });
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            hostId: this.hostId,
            players: this.players.length,
            maxPlayers: this.maxPlayers,
            gameStarted: this.gameStarted,
            isPrivate: this.isPrivate
        };
    }

    getFullInfo() {
        return {
            id: this.id,
            name: this.name,
            hostId: this.hostId,
            players: this.players,
            maxPlayers: this.maxPlayers,
            gameStarted: this.gameStarted,
            isPrivate: this.isPrivate,
            accessCode: this.accessCode,
            availableColors: AVAILABLE_COLORS.filter(c => !this.usedColors.has(c))
        };
    }
}

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    const broadcastRoomsList = () => {
        io.emit('rooms-list', Array.from(rooms.values()).map(r => r.toJSON()));
    };

    players.set(socket.id, {
        id: socket.id,
        name: `Player ${players.size + 1}`,
        roomId: null
    });

    // Send initial rooms list
    socket.emit('rooms-list', Array.from(rooms.values()).map(r => r.toJSON()));

    // Set player nickname
    socket.on('set-nickname', (nickname) => {
        const player = players.get(socket.id);
        if (player && nickname && nickname.trim()) {
            player.name = nickname.trim().substring(0, 20); // Limit to 20 chars
            
            // Update nickname in room if player is in one
            if (player.roomId) {
                const room = rooms.get(player.roomId);
                if (room) {
                    const roomPlayer = room.players.find(p => p.id === socket.id);
                    if (roomPlayer) {
                        roomPlayer.name = player.name;
                        io.to(player.roomId).emit('room-update', room.getFullInfo());
                    }
                }
            }
            
            console.log(`Player ${socket.id} set nickname to: ${player.name}`);
        }
    });

    // Create room
    socket.on('create-room', (data) => {
        const payload = data || {};
        const isPrivate = !!payload.isPrivate;
        let accessCode = null;

        if (isPrivate) {
            if (typeof payload.accessCode !== 'string') {
                socket.emit('error', { message: 'Access code required' });
                return;
            }

            accessCode = payload.accessCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

            if (accessCode.length < 4) {
                socket.emit('error', { message: 'Access code required' });
                return;
            }

            if (accessCode.length > 8) {
                accessCode = accessCode.slice(0, 8);
            }
        }

        const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const roomName = payload.name || `Room ${rooms.size + 1}`;
        const room = new Room(roomId, roomName, socket.id);
        room.isPrivate = isPrivate;
        room.accessCode = accessCode;

        const player = players.get(socket.id);
        if (player) {
            player.roomId = roomId;
            room.addPlayer(socket.id, player.name);
        }

        rooms.set(roomId, room);
        socket.join(roomId);

        socket.emit('room-created', room.getFullInfo());
        broadcastRoomsList();

        console.log(`Room created: ${roomName} (${roomId})`);
    });

    // Join room
    socket.on('join-room', (data) => {
        const payload = typeof data === 'object' && data !== null ? data : { roomId: data };
        const roomId = payload.roomId;
        const accessCode = typeof payload.accessCode === 'string'
            ? payload.accessCode.trim().toUpperCase()
            : null;

        const room = rooms.get(roomId);
        const player = players.get(socket.id);

        if (!room) {
            socket.emit('error', { message: 'Room not found' });
            return;
        }

        if (room.isPrivate) {
            if (!accessCode || accessCode !== room.accessCode) {
                socket.emit('error', { message: 'Invalid access code' });
                return;
            }
        }

        if (room.gameStarted) {
            socket.emit('error', { message: 'Game already started' });
            return;
        }

        if (player) {
            const success = room.addPlayer(socket.id, player.name);
            if (success) {
                player.roomId = roomId;
                socket.join(roomId);

                // Notify all players in room
                io.to(roomId).emit('room-update', room.getFullInfo());
                socket.emit('room-joined', room.getFullInfo());
                broadcastRoomsList();

                console.log(`${player.name} joined room ${room.name}`);
            } else {
                socket.emit('error', { message: 'Room is full' });
            }
        }
    });

    // Leave room
    socket.on('leave-room', () => {
        const player = players.get(socket.id);
        if (player && player.roomId) {
            const room = rooms.get(player.roomId);
            if (room) {
                room.removePlayer(socket.id);
                socket.leave(player.roomId);
                
                if (room.players.length === 0) {
                    rooms.delete(player.roomId);
                    broadcastRoomsList();
                    console.log(`Room ${room.name} deleted (empty)`);
                } else {
                    io.to(player.roomId).emit('room-update', room.getFullInfo());
                    broadcastRoomsList();
                }

                player.roomId = null;
                socket.emit('left-room');
            }
        }
    });

    socket.on('kick-player', (targetId) => {
        const hostPlayer = players.get(socket.id);
        if (!hostPlayer || !hostPlayer.roomId) {
            return;
        }

        const room = rooms.get(hostPlayer.roomId);
        if (!room || room.hostId !== socket.id) {
            return;
        }

        if (targetId === socket.id) {
            return;
        }

        const targetPlayer = players.get(targetId);
        if (!targetPlayer || targetPlayer.roomId !== room.id) {
            return;
        }

        const wasRemoved = room.removePlayer(targetId);
        if (!wasRemoved) {
            return;
        }

        targetPlayer.roomId = null;

        const targetSocket = io.sockets.sockets.get(targetId);
        if (targetSocket) {
            targetSocket.leave(room.id);
            targetSocket.emit('left-room');
            targetSocket.emit('kicked', { roomId: room.id, roomName: room.name });
        }

        if (room.players.length === 0) {
            rooms.delete(room.id);
        } else {
            io.to(room.id).emit('room-update', room.getFullInfo());
        }

        broadcastRoomsList();
    });

    // Change color
    socket.on('change-color', (color) => {
        const player = players.get(socket.id);
        if (player && player.roomId) {
            const room = rooms.get(player.roomId);
            if (room) {
                const success = room.setPlayerColor(socket.id, color);
                if (success) {
                    io.to(player.roomId).emit('room-update', room.getFullInfo());
                } else {
                    socket.emit('error', { message: 'Color already taken' });
                }
            }
        }
    });

    // Toggle ready
    socket.on('toggle-ready', () => {
        const player = players.get(socket.id);
        if (player && player.roomId) {
            const room = rooms.get(player.roomId);
            if (room) {
                const currentPlayer = room.players.find(p => p.id === socket.id);
                if (currentPlayer) {
                    room.setPlayerReady(socket.id, !currentPlayer.ready);
                    io.to(player.roomId).emit('room-update', room.getFullInfo());
                    
                    // Check if all players are ready
                    // Allow solo practice (1 player) or multiplayer (2+ players)
                    if (room.allPlayersReady() && room.players.length >= 1) {
                        const pieceSeed = Math.floor(Math.random() * 0xffffffff);
                        room.beginGame(pieceSeed);
                        io.to(player.roomId).emit('game-start', {
                            players: room.players,
                            pieceSeed
                        });
                        io.to(player.roomId).emit('room-update', room.getFullInfo());
                        broadcastRoomsList();
                        console.log(`Game starting in room ${room.name} with ${room.players.length} player(s)`);
                    }
                }
            }
        }
    });

    // Game state sync
    socket.on('game-state', (data) => {
        const player = players.get(socket.id);
        if (player && player.roomId) {
            socket.to(player.roomId).emit('game-state', {
                playerId: socket.id,
                ...data
            });
        }
    });

    // Player input
    socket.on('player-input', (data) => {
        const player = players.get(socket.id);
        if (player && player.roomId) {
            socket.to(player.roomId).emit('player-input', {
                playerId: socket.id,
                ...data
            });
        }
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        
        const player = players.get(socket.id);
        if (player && player.roomId) {
            const room = rooms.get(player.roomId);
            if (room) {
                room.removePlayer(socket.id);
                
                if (room.players.length === 0) {
                    rooms.delete(player.roomId);
                    io.emit('rooms-list', Array.from(rooms.values()).map(r => r.toJSON()));
                    console.log(`Room ${room.name} deleted (empty)`);
                } else {
                    io.to(player.roomId).emit('room-update', room.getFullInfo());
                }
            }
        }
        
        players.delete(socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
