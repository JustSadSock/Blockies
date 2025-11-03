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

const PIECE_ORDER = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

function mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffleWithRng(items, rng) {
    const list = [...items];
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

function createPieceDealer(seed) {
    const normalizedSeed = seed >>> 0;
    const rng = mulberry32(normalizedSeed);
    let bag = [];
    return {
        seed: normalizedSeed,
        nextBatch(count = 32) {
            const pieces = [];
            for (let i = 0; i < count; i++) {
                if (!bag.length) {
                    bag = shuffleWithRng(PIECE_ORDER, rng);
                }
                pieces.push(bag.pop());
            }
            return pieces;
        }
    };
}

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

            let hostChanged = false;

            // If host left, assign new host
            if (this.hostId === playerId && this.players.length > 0) {
                this.hostId = this.players[0].id;
                hostChanged = true;
            }

            return { removed: true, hostChanged };
        }
        return { removed: false, hostChanged: false };
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
        const normalizedSeed = Number.isFinite(seed)
            ? (seed >>> 0)
            : Math.floor(Math.random() * 0xffffffff);

        this.players.forEach(player => {
            player.ready = false;
        });

        const dealer = createPieceDealer(normalizedSeed);
        const initialPieces = dealer.nextBatch(224);

        this.gameStarted = true;
        this.currentGame = {
            seed: normalizedSeed,
            startedAt: Date.now(),
            dealer,
            initialPieces,
            stateSequence: 0,
            inputSequence: 0,
            lastStatePayload: null,
            lastBroadcastAt: 0
        };

        return {
            seed: normalizedSeed,
            initialPieces
        };
    }

    getNextPieces(count = 64) {
        if (!this.currentGame || !this.currentGame.dealer) {
            return [];
        }
        return this.currentGame.dealer.nextBatch(count);
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
                const removal = room.removePlayer(socket.id);
                if (!removal.removed) {
                    return;
                }

                socket.leave(player.roomId);

                if (room.players.length === 0) {
                    rooms.delete(player.roomId);
                    broadcastRoomsList();
                    console.log(`Room ${room.name} deleted (empty)`);
                } else {
                    io.to(player.roomId).emit('room-update', room.getFullInfo());
                    if (removal.hostChanged) {
                        io.to(room.id).emit('host-changed', { hostId: room.hostId });
                    }
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

        const removal = room.removePlayer(targetId);
        if (!removal.removed) {
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
            if (removal.hostChanged) {
                io.to(room.id).emit('host-changed', { hostId: room.hostId });
            }
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
                        const randomSeed = Math.floor(Math.random() * 0xffffffff);
                        const { seed: pieceSeed, initialPieces } = room.beginGame(randomSeed);
                        io.to(player.roomId).emit('game-start', {
                            players: room.players,
                            pieceSeed,
                            pieceSequence: initialPieces,
                            hostId: room.hostId
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
    socket.on('game-state', (data = {}) => {
        const player = players.get(socket.id);
        if (!player || !player.roomId) {
            return;
        }

        const room = rooms.get(player.roomId);
        if (!room || !room.currentGame) {
            return;
        }

        if (socket.id !== room.hostId) {
            return;
        }

        const providedSequence = typeof data.sequence === 'number' ? data.sequence : null;
        const nextSequence = providedSequence !== null
            ? providedSequence
            : (room.currentGame.stateSequence + 1);

        room.currentGame.stateSequence = nextSequence;
        room.currentGame.lastStatePayload = {
            ...data,
            sequence: nextSequence
        };
        room.currentGame.lastBroadcastAt = Date.now();

        socket.to(room.id).emit('game-state', {
            ...room.currentGame.lastStatePayload,
            serverTime: Date.now()
        });
    });

    socket.on('request-sync', () => {
        const player = players.get(socket.id);
        if (!player || !player.roomId) {
            return;
        }

        const room = rooms.get(player.roomId);
        if (!room || !room.currentGame || !room.currentGame.lastStatePayload) {
            return;
        }

        socket.emit('game-state', {
            ...room.currentGame.lastStatePayload,
            serverTime: Date.now()
        });
    });

    // Player input
    socket.on('player-input', (data) => {
        const player = players.get(socket.id);
        if (!player || !player.roomId) {
            return;
        }

        const room = rooms.get(player.roomId);
        if (!room) {
            return;
        }

        if (!room.currentGame) {
            socket.to(player.roomId).emit('player-input', {
                playerId: socket.id,
                ...data
            });
            return;
        }

        room.currentGame.inputSequence += 1;
        socket.to(player.roomId).emit('player-input', {
            playerId: socket.id,
            sequence: room.currentGame.inputSequence,
            ...data
        });
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        
        const player = players.get(socket.id);
        if (player && player.roomId) {
            const room = rooms.get(player.roomId);
            if (room) {
                const removal = room.removePlayer(socket.id);

                if (removal.removed && room.players.length === 0) {
                    rooms.delete(player.roomId);
                    io.emit('rooms-list', Array.from(rooms.values()).map(r => r.toJSON()));
                    console.log(`Room ${room.name} deleted (empty)`);
                } else if (removal.removed) {
                    io.to(player.roomId).emit('room-update', room.getFullInfo());
                    if (removal.hostChanged) {
                        io.to(room.id).emit('host-changed', { hostId: room.hostId });
                    }
                }
            }
        }
        
        players.delete(socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
