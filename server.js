const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const crypto = require('crypto');

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
const sessions = new Map();

const RECONNECT_GRACE_MS = 30000;

function broadcastRoomsList() {
    io.emit('rooms-list', Array.from(rooms.values()).map(r => r.toJSON()));
}

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

function generateSessionId() {
    return crypto.randomBytes(8).toString('hex');
}

function createSession(defaultName) {
    const sessionId = generateSessionId();
    const session = {
        id: sessionId,
        name: defaultName || `Player ${sessions.size + 1}`,
        roomId: null,
        color: null,
        ready: false,
        connected: false,
        socketId: null,
        disconnectTimer: null
    };
    sessions.set(sessionId, session);
    return session;
}

function getSession(sessionId) {
    if (!sessionId) return null;
    return sessions.get(sessionId) || null;
}

function attachSessionToSocket(session, socket) {
    if (!session) return;

    const player = players.get(socket.id);
    if (player) {
        player.sessionId = session.id;
        player.name = session.name;
        player.roomId = session.roomId;
    }

    session.socketId = socket.id;
    session.connected = true;
    session.disconnectTimer && clearTimeout(session.disconnectTimer);
    session.disconnectTimer = null;
}

function scheduleSessionCleanup(sessionId) {
    const session = getSession(sessionId);
    if (!session || session.disconnectTimer) {
        return;
    }

    session.disconnectTimer = setTimeout(() => {
        finalizeSessionRoomCleanup(sessionId);
    }, RECONNECT_GRACE_MS);
}

function finalizeSessionRoomCleanup(sessionId) {
    const session = getSession(sessionId);
    if (!session) return;

    if (!session.roomId) {
        session.disconnectTimer = null;
        return;
    }

    const room = rooms.get(session.roomId);
    if (room) {
        const removal = room.removePlayer(sessionId);
        if (removal.removed) {
            if (room.players.length === 0) {
                rooms.delete(room.id);
            } else {
                io.to(room.id).emit('room-update', room.getFullInfo());
                if (removal.hostChanged) {
                    io.to(room.id).emit('host-changed', {
                        hostId: room.hostSocketId,
                        hostSessionId: room.hostSessionId
                    });
                }
            }
            broadcastRoomsList();
        }
    }

    session.roomId = null;
    session.color = null;
    session.ready = false;
    session.disconnectTimer = null;
}

class Room {
    constructor(id, name, hostSessionId) {
        this.id = id;
        this.name = name;
        this.hostSessionId = hostSessionId;
        this.players = [];
        this.maxPlayers = 4;
        this.gameStarted = false;
        this.usedColors = new Set();
        this.isPrivate = false;
        this.accessCode = null;
        this.currentGame = null;
    }

    get hostSocketId() {
        const host = this.players.find(p => p.sessionId === this.hostSessionId && p.connected && p.socketId);
        return host ? host.socketId : null;
    }

    getPlayerBySession(sessionId) {
        return this.players.find(p => p.sessionId === sessionId) || null;
    }

    getPlayerBySocket(socketId) {
        return this.players.find(p => p.socketId === socketId) || null;
    }

    pickNextHost() {
        const connectedPlayer = this.players.find(p => p.connected);
        const originalHost = this.hostSessionId;
        if (connectedPlayer) {
            this.hostSessionId = connectedPlayer.sessionId;
        } else if (this.players.length > 0) {
            this.hostSessionId = this.players[0].sessionId;
        }
        return originalHost !== this.hostSessionId;
    }

    addOrUpdatePlayer(sessionId, socketId, playerName, preferredColor = null) {
        let player = this.getPlayerBySession(sessionId);
        let rejoined = false;

        if (player) {
            player.socketId = socketId;
            player.name = playerName;
            player.connected = true;
            player.ready = false;
            rejoined = true;
        } else {
            if (this.players.length >= this.maxPlayers) {
                return { success: false, rejoined: false };
            }

            const reservedColor = preferredColor && !this.usedColors.has(preferredColor)
                ? preferredColor
                : AVAILABLE_COLORS.find(color => !this.usedColors.has(color));

            if (!reservedColor) {
                return { success: false, rejoined: false };
            }

            player = {
                sessionId,
                socketId,
                name: playerName,
                color: reservedColor,
                ready: false,
                connected: true
            };
            this.players.push(player);
            this.usedColors.add(reservedColor);
        }

        return { success: true, rejoined };
    }

    markPlayerDisconnected(sessionId) {
        const player = this.getPlayerBySession(sessionId);
        if (!player) {
            return { updated: false, hostChanged: false };
        }

        player.connected = false;
        player.socketId = null;
        player.ready = false;
        const hostChanged = player.sessionId === this.hostSessionId && this.pickNextHost();
        return { updated: true, hostChanged };
    }

    removePlayer(sessionId) {
        const index = this.players.findIndex(p => p.sessionId === sessionId);
        if (index === -1) {
            return { removed: false, hostChanged: false };
        }

        const [player] = this.players.splice(index, 1);
        this.usedColors.delete(player.color);
        const hostChanged = player.sessionId === this.hostSessionId && this.pickNextHost();
        return { removed: true, hostChanged };
    }

    setPlayerColor(sessionId, color) {
        if (!color || this.usedColors.has(color)) {
            return false;
        }

        const player = this.getPlayerBySession(sessionId);
        if (!player) {
            return false;
        }

        this.usedColors.delete(player.color);
        player.color = color;
        this.usedColors.add(color);
        return true;
    }

    setPlayerReady(sessionId, ready) {
        const player = this.getPlayerBySession(sessionId);
        if (!player || !player.connected) {
            return false;
        }
        player.ready = ready;
        return true;
    }

    allPlayersReady() {
        return this.players.length > 0 && this.players.every(p => p.connected && p.ready);
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
            lastBroadcastAt: 0,
            lastInputByPlayer: {}
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

    recordPlayerInput(sessionId, sequence) {
        if (!this.currentGame || typeof sequence !== 'number') {
            return;
        }
        this.currentGame.lastInputByPlayer[sessionId] = sequence;
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
            hostId: this.hostSocketId,
            hostSessionId: this.hostSessionId,
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
            hostId: this.hostSocketId,
            hostSessionId: this.hostSessionId,
            players: this.players.map(p => ({
                id: p.socketId,
                sessionId: p.sessionId,
                name: p.name,
                color: p.color,
                ready: p.ready,
                connected: p.connected
            })),
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

    const defaultName = `Player ${players.size + 1}`;
    players.set(socket.id, {
        id: socket.id,
        sessionId: null,
        name: defaultName,
        roomId: null
    });

    socket.emit('rooms-list', Array.from(rooms.values()).map(r => r.toJSON()));

    socket.on('identify', (payload = {}) => {
        const providedSessionId = typeof payload.sessionId === 'string'
            ? payload.sessionId.trim()
            : null;

        let session = getSession(providedSessionId);
        if (!session) {
            session = createSession(defaultName);
        }

        if (payload.nickname && payload.nickname.trim()) {
            session.name = payload.nickname.trim().substring(0, 20);
        }

        attachSessionToSocket(session, socket);

        const player = players.get(socket.id);
        if (player) {
            player.sessionId = session.id;
            player.name = session.name;
            player.roomId = session.roomId;
        }

        socket.emit('session-confirmed', {
            sessionId: session.id,
            name: session.name,
            restoredRoom: !!session.roomId
        });

        if (session.roomId) {
            const room = rooms.get(session.roomId);
            if (room) {
                const result = room.addOrUpdatePlayer(session.id, socket.id, session.name, session.color);
                if (result.success) {
                    const info = room.getFullInfo();
                    const roomPlayer = room.getPlayerBySession(session.id);
                    if (roomPlayer) {
                        session.color = roomPlayer.color;
                    }
                    if (player) {
                        player.roomId = room.id;
                    }
                    socket.join(room.id);
                    socket.emit('room-joined', info);
                    io.to(room.id).emit('room-update', info);
                    broadcastRoomsList();

                    if (room.gameStarted && room.currentGame?.lastStatePayload) {
                        socket.emit('game-start', {
                            players: info.players,
                            pieceSeed: room.currentGame.seed,
                            pieceSequence: room.currentGame.initialPieces,
                            hostId: info.hostId,
                            hostSessionId: info.hostSessionId,
                            resumed: true
                        });
                        socket.emit('game-state', {
                            ...room.currentGame.lastStatePayload,
                            serverTime: Date.now()
                        });
                    }
                } else {
                    session.roomId = null;
                    if (player) {
                        player.roomId = null;
                    }
                }
            } else {
                session.roomId = null;
                if (player) {
                    player.roomId = null;
                }
            }
        }
    });

    socket.on('set-nickname', (nickname) => {
        if (!nickname || !nickname.trim()) {
            return;
        }

        const player = players.get(socket.id);
        if (!player) {
            return;
        }

        const session = getSession(player.sessionId) || createSession(defaultName);
        const sanitized = nickname.trim().substring(0, 20);
        player.name = sanitized;
        session.name = sanitized;

        if (player.roomId) {
            const room = rooms.get(player.roomId);
            if (room) {
                const roomPlayer = room.getPlayerBySession(session.id);
                if (roomPlayer) {
                    roomPlayer.name = sanitized;
                    io.to(room.id).emit('room-update', room.getFullInfo());
                }
            }
        }

        console.log(`Player ${socket.id} set nickname to: ${sanitized}`);
    });

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

        const player = players.get(socket.id);
        if (!player) {
            return;
        }

        let session = getSession(player.sessionId);
        if (!session) {
            session = createSession(player.name);
            attachSessionToSocket(session, socket);
            player.sessionId = session.id;
        }

        const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const roomName = payload.name || `Room ${rooms.size + 1}`;
        const room = new Room(roomId, roomName, session.id);
        room.isPrivate = isPrivate;
        room.accessCode = accessCode;

        const result = room.addOrUpdatePlayer(session.id, socket.id, session.name, session.color);
        if (!result.success) {
            socket.emit('error', { message: 'Unable to reserve a slot in the new room.' });
            return;
        }

        const roomPlayer = room.getPlayerBySession(session.id);
        if (roomPlayer) {
            session.color = roomPlayer.color;
        }

        rooms.set(roomId, room);
        session.roomId = roomId;
        session.ready = false;
        if (session.disconnectTimer) {
            clearTimeout(session.disconnectTimer);
            session.disconnectTimer = null;
        }

        player.roomId = roomId;
        socket.join(roomId);

        const info = room.getFullInfo();
        socket.emit('room-created', info);
        broadcastRoomsList();

        console.log(`Room created: ${roomName} (${roomId})`);
    });

    socket.on('join-room', (data) => {
        const payload = typeof data === 'object' && data !== null ? data : { roomId: data };
        const roomId = payload.roomId;
        const accessCode = typeof payload.accessCode === 'string'
            ? payload.accessCode.trim().toUpperCase()
            : null;

        const room = rooms.get(roomId);
        const player = players.get(socket.id);
        if (!room || !player) {
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

        let session = getSession(player.sessionId);
        if (!session) {
            session = createSession(player.name);
            attachSessionToSocket(session, socket);
            player.sessionId = session.id;
        }

        const result = room.addOrUpdatePlayer(session.id, socket.id, session.name, session.color);
        if (!result.success) {
            socket.emit('error', { message: 'Room is full' });
            return;
        }

        const roomPlayer = room.getPlayerBySession(session.id);
        if (roomPlayer) {
            session.color = roomPlayer.color;
        }

        session.roomId = roomId;
        session.ready = false;
        if (session.disconnectTimer) {
            clearTimeout(session.disconnectTimer);
            session.disconnectTimer = null;
        }

        player.roomId = roomId;
        socket.join(roomId);

        const info = room.getFullInfo();
        socket.emit('room-joined', info);
        io.to(room.id).emit('room-update', info);
        broadcastRoomsList();

        console.log(`${session.name} joined room ${room.name}`);
    });

    socket.on('leave-room', () => {
        const player = players.get(socket.id);
        if (!player || !player.roomId) {
            return;
        }

        const room = rooms.get(player.roomId);
        const session = getSession(player.sessionId);
        if (!room || !session) {
            return;
        }

        const removal = room.removePlayer(session.id);
        if (!removal.removed) {
            return;
        }

        socket.leave(room.id);

        session.roomId = null;
        session.ready = false;
        session.color = null;
        if (session.disconnectTimer) {
            clearTimeout(session.disconnectTimer);
            session.disconnectTimer = null;
        }

        player.roomId = null;
        socket.emit('left-room');

        if (room.players.length === 0) {
            rooms.delete(room.id);
            broadcastRoomsList();
            console.log(`Room ${room.name} deleted (empty)`);
            return;
        }

        const info = room.getFullInfo();
        io.to(room.id).emit('room-update', info);
        if (removal.hostChanged) {
            io.to(room.id).emit('host-changed', {
                hostId: info.hostId,
                hostSessionId: info.hostSessionId
            });
        }
        broadcastRoomsList();
    });

    socket.on('kick-player', (targetId) => {
        const hostPlayer = players.get(socket.id);
        if (!hostPlayer || !hostPlayer.roomId) {
            return;
        }

        const room = rooms.get(hostPlayer.roomId);
        const hostSession = getSession(hostPlayer.sessionId);
        if (!room || !hostSession || room.hostSessionId !== hostSession.id || room.hostSocketId !== socket.id) {
            return;
        }

        const targetEntry = room.getPlayerBySession(targetId) || room.getPlayerBySocket(targetId);
        if (!targetEntry || targetEntry.sessionId === hostSession.id) {
            return;
        }

        const removal = room.removePlayer(targetEntry.sessionId);
        if (!removal.removed) {
            return;
        }

        const targetSession = getSession(targetEntry.sessionId);
        if (targetSession) {
            targetSession.roomId = null;
            targetSession.color = null;
            targetSession.ready = false;
            if (targetSession.disconnectTimer) {
                clearTimeout(targetSession.disconnectTimer);
                targetSession.disconnectTimer = null;
            }
        }

        if (targetEntry.socketId) {
            const targetSocket = io.sockets.sockets.get(targetEntry.socketId);
            if (targetSocket) {
                targetSocket.leave(room.id);
                targetSocket.emit('left-room');
                targetSocket.emit('kicked', { roomId: room.id, roomName: room.name });
            }
        }

        if (room.players.length === 0) {
            rooms.delete(room.id);
            broadcastRoomsList();
            return;
        }

        const info = room.getFullInfo();
        io.to(room.id).emit('room-update', info);
        if (removal.hostChanged) {
            io.to(room.id).emit('host-changed', {
                hostId: info.hostId,
                hostSessionId: info.hostSessionId
            });
        }
        broadcastRoomsList();
    });

    socket.on('change-color', (color) => {
        const player = players.get(socket.id);
        if (!player || !player.roomId) {
            return;
        }

        const session = getSession(player.sessionId);
        const room = rooms.get(player.roomId);
        if (!session || !room) {
            return;
        }

        const success = room.setPlayerColor(session.id, color);
        if (!success) {
            socket.emit('error', { message: 'Color already taken' });
            return;
        }

        const roomPlayer = room.getPlayerBySession(session.id);
        if (roomPlayer) {
            session.color = roomPlayer.color;
        }

        const info = room.getFullInfo();
        io.to(room.id).emit('room-update', info);
    });

    socket.on('toggle-ready', () => {
        const player = players.get(socket.id);
        if (!player || !player.roomId) {
            return;
        }

        const session = getSession(player.sessionId);
        const room = rooms.get(player.roomId);
        if (!session || !room) {
            return;
        }

        const roomPlayer = room.getPlayerBySession(session.id);
        if (!roomPlayer) {
            return;
        }

        const readyState = !roomPlayer.ready;
        room.setPlayerReady(session.id, readyState);
        session.ready = readyState;

        const info = room.getFullInfo();
        io.to(room.id).emit('room-update', info);

        if (room.allPlayersReady() && room.players.length >= 1) {
            const randomSeed = Math.floor(Math.random() * 0xffffffff);
            const { seed: pieceSeed, initialPieces } = room.beginGame(randomSeed);
            const updatedInfo = room.getFullInfo();
            io.to(room.id).emit('game-start', {
                players: updatedInfo.players,
                pieceSeed,
                pieceSequence: initialPieces,
                hostId: updatedInfo.hostId,
                hostSessionId: updatedInfo.hostSessionId
            });
            io.to(room.id).emit('room-update', updatedInfo);
            broadcastRoomsList();
            console.log(`Game starting in room ${room.name} with ${room.players.length} player(s)`);
        }
    });

    socket.on('game-state', (data = {}) => {
        const player = players.get(socket.id);
        if (!player || !player.roomId) {
            return;
        }

        const room = rooms.get(player.roomId);
        if (!room || !room.currentGame) {
            return;
        }

        if (socket.id !== room.hostSocketId) {
            return;
        }

        const providedSequence = typeof data.sequence === 'number' ? data.sequence : null;
        const nextSequence = providedSequence !== null
            ? providedSequence
            : (room.currentGame.stateSequence + 1);

        room.currentGame.stateSequence = nextSequence;
        room.currentGame.lastStatePayload = {
            ...data,
            sequence: nextSequence,
            inputAcks: { ...room.currentGame.lastInputByPlayer }
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

    socket.on('player-input', (data = {}) => {
        const player = players.get(socket.id);
        if (!player || !player.roomId) {
            return;
        }

        const session = getSession(player.sessionId);
        const room = rooms.get(player.roomId);
        if (!session || !room) {
            return;
        }

        if (!room.currentGame) {
            socket.to(room.id).emit('player-input', {
                playerId: session.id,
                ...data
            });
            socket.emit('input-ack', { sequence: null });
            return;
        }

        room.currentGame.inputSequence += 1;
        const sequence = room.currentGame.inputSequence;
        room.recordPlayerInput(session.id, sequence);

        socket.to(room.id).emit('player-input', {
            playerId: session.id,
            sequence,
            ...data
        });

        socket.emit('input-ack', { sequence });
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);

        const player = players.get(socket.id);
        const session = player ? getSession(player.sessionId) : null;

        if (session && session.roomId) {
            const room = rooms.get(session.roomId);
            if (room) {
                const { hostChanged } = room.markPlayerDisconnected(session.id);

                if (room.players.length === 0) {
                    rooms.delete(room.id);
                    broadcastRoomsList();
                } else {
                    const info = room.getFullInfo();
                    io.to(room.id).emit('room-update', info);
                    if (hostChanged) {
                        io.to(room.id).emit('host-changed', {
                            hostId: info.hostId,
                            hostSessionId: info.hostSessionId
                        });
                    }
                    broadcastRoomsList();
                }
            }

            scheduleSessionCleanup(session.id);
        }

        if (session) {
            session.connected = false;
            session.socketId = null;
        }

        players.delete(socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
