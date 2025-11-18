// Network manager for Blockies multiplayer
class NetworkManager {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.currentRoom = null;
        this.serverUrl = 'https://irgri.uk';
        this.sessionId = null;
        this.sessionStorageKey = 'blockies-session-id';
        this.callbacks = {
            onConnect: null,
            onDisconnect: null,
            onSessionConfirmed: null,
            onRoomsList: null,
            onRoomCreated: null,
            onRoomJoined: null,
            onRoomUpdate: null,
            onLeftRoom: null,
            onGameStart: null,
            onGameState: null,
            onPlayerInput: null,
            onPlayerKicked: null,
            onHostChanged: null,
            onInputAck: null,
            onReconnecting: null,
            onReconnected: null,
            onReconnectFailed: null,
            onError: null
        };
        this.resumeIntent = null;
        this.pendingRejoin = false;
        this.maxReconnectAttempts = null;
        this.manualDisconnect = false;
    }

    connect() {
        if (this.socket && this.connected) {
            console.log('Already connected');
            return;
        }

        try {
            // Try to load socket.io client
            if (typeof io === 'undefined') {
                console.error('Socket.io client not loaded');
                if (this.callbacks.onError) {
                    this.callbacks.onError('Socket.io client not available');
                }
                return;
            }

            console.log('Connecting to server:', this.serverUrl);
            this.socket = io(this.serverUrl, {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionDelay: 1000,
                reconnectionAttempts: 5
            });

            this.pendingRejoin = false;
            this.maxReconnectAttempts = this.socket && this.socket.io && typeof this.socket.io.opts.reconnectionAttempts === 'number'
                ? this.socket.io.opts.reconnectionAttempts
                : null;

            this.setupEventListeners();
        } catch (error) {
            console.error('Failed to connect:', error);
            if (this.callbacks.onError) {
                this.callbacks.onError('Connection failed: ' + error.message);
            }
        }
    }

    setupEventListeners() {
        if (!this.socket) return;

        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.connected = true;
            this.identify();
            if (this.callbacks.onConnect) {
                this.callbacks.onConnect();
            }
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            const wasManual = this.manualDisconnect;
            this.manualDisconnect = false;
            if (this.currentRoom && !wasManual) {
                this.rememberRoomIntent(this.currentRoom);
            }
            this.connected = false;
            this.pendingRejoin = false;
            if (this.callbacks.onDisconnect) {
                this.callbacks.onDisconnect();
            }
            if (!wasManual && this.callbacks.onReconnecting) {
                this.callbacks.onReconnecting({
                    attempt: 1,
                    maxAttempts: this.maxReconnectAttempts
                });
            }
        });

        if (this.socket.io) {
            this.socket.io.on('reconnect_attempt', (attempt) => {
                if (this.manualDisconnect) {
                    return;
                }
                if (this.callbacks.onReconnecting) {
                    this.callbacks.onReconnecting({
                        attempt: Math.max(1, attempt || 1),
                        maxAttempts: this.maxReconnectAttempts
                    });
                }
            });

            this.socket.io.on('reconnect', (attempt) => {
                if (this.callbacks.onReconnected) {
                    this.callbacks.onReconnected({ attempt });
                }
            });

            this.socket.io.on('reconnect_failed', () => {
                if (this.callbacks.onReconnectFailed) {
                    this.callbacks.onReconnectFailed();
                }
            });
        }

        this.socket.on('session-confirmed', (data) => {
            if (data && typeof data.sessionId === 'string') {
                this.sessionId = data.sessionId;
                try {
                    if (typeof localStorage !== 'undefined') {
                        localStorage.setItem(this.sessionStorageKey, data.sessionId);
                    }
                } catch (storageError) {
                    console.warn('Unable to persist session ID', storageError);
                }
            }

            const restored = data && data.restoredRoom;
            if (restored) {
                this.pendingRejoin = false;
            } else if (this.resumeIntent && this.resumeIntent.roomId && !this.pendingRejoin && !this.manualDisconnect) {
                const intent = { ...this.resumeIntent };
                this.pendingRejoin = true;
                setTimeout(() => {
                    if (this.socket && this.connected) {
                        this.joinRoom(intent.roomId, intent.accessCode || null);
                    } else {
                        this.pendingRejoin = false;
                    }
                }, 200);
            }

            if (this.callbacks.onSessionConfirmed) {
                this.callbacks.onSessionConfirmed(data);
            }
        });

        this.socket.on('rooms-list', (rooms) => {
            console.log('Rooms list received:', rooms);
            if (this.callbacks.onRoomsList) {
                this.callbacks.onRoomsList(rooms);
            }
        });

        this.socket.on('room-created', (room) => {
            console.log('Room created:', room);
            this.currentRoom = room;
            this.rememberRoomIntent(room);
            this.pendingRejoin = false;
            if (this.callbacks.onRoomCreated) {
                this.callbacks.onRoomCreated(room);
            }
        });

        this.socket.on('room-joined', (room) => {
            console.log('Room joined:', room);
            this.currentRoom = room;
            this.rememberRoomIntent(room);
            this.pendingRejoin = false;
            if (this.callbacks.onRoomJoined) {
                this.callbacks.onRoomJoined(room);
            }
        });

        this.socket.on('room-update', (room) => {
            console.log('Room updated:', room);
            this.currentRoom = room;
            this.rememberRoomIntent(room);
            if (this.callbacks.onRoomUpdate) {
                this.callbacks.onRoomUpdate(room);
            }
        });

        this.socket.on('left-room', () => {
            console.log('Left room');
            this.currentRoom = null;
            this.rememberRoomIntent(null);
            this.pendingRejoin = false;
            if (this.callbacks.onLeftRoom) {
                this.callbacks.onLeftRoom();
            }
        });

        this.socket.on('game-start', (data) => {
            console.log('Game starting:', data);
            if (this.currentRoom) {
                this.currentRoom.gameStarted = true;
                this.rememberRoomIntent(this.currentRoom);
            }
            if (this.callbacks.onGameStart) {
                this.callbacks.onGameStart(data);
            }
        });

        this.socket.on('game-state', (data) => {
            if (this.callbacks.onGameState) {
                this.callbacks.onGameState(data);
            }
        });

        this.socket.on('host-changed', (payload) => {
            if (this.callbacks.onHostChanged) {
                this.callbacks.onHostChanged(payload);
            }
        });

        this.socket.on('player-input', (data) => {
            if (this.callbacks.onPlayerInput) {
                this.callbacks.onPlayerInput(data);
            }
        });

        this.socket.on('input-ack', (data) => {
            if (this.callbacks.onInputAck) {
                this.callbacks.onInputAck(data);
            }
        });

        this.socket.on('error', (error) => {
            console.error('Server error:', error);
            this.pendingRejoin = false;
            if (this.callbacks.onError) {
                this.callbacks.onError(error.message);
            }
        });

        this.socket.on('kicked', (info) => {
            console.log('Kicked from room:', info);
            this.currentRoom = null;
            this.rememberRoomIntent(null);
            this.pendingRejoin = false;
            if (this.callbacks.onPlayerKicked) {
                this.callbacks.onPlayerKicked(info);
            }
        });
    }

    identify() {
        if (!this.socket) {
            return;
        }

        let storedSessionId = null;
        try {
            if (typeof localStorage !== 'undefined') {
                storedSessionId = localStorage.getItem(this.sessionStorageKey);
            }
        } catch (error) {
            console.warn('Unable to read stored session id', error);
        }

        const payload = {};
        if (storedSessionId || this.sessionId) {
            payload.sessionId = storedSessionId || this.sessionId;
        }

        try {
            if (typeof localStorage !== 'undefined') {
                const nickname = localStorage.getItem('blockies-nickname');
                if (nickname) {
                    payload.nickname = nickname;
                }
            }
        } catch (error) {
            console.warn('Unable to read saved nickname', error);
        }

        this.socket.emit('identify', payload);
    }

    rememberRoomIntent(room) {
        if (!room || !room.id) {
            if (!this.manualDisconnect) {
                this.resumeIntent = null;
            }
            return;
        }

        this.resumeIntent = {
            roomId: room.id,
            accessCode: room.accessCode || null,
            isPrivate: !!room.isPrivate,
            gameStarted: !!room.gameStarted
        };
    }

    getMaxReconnectAttempts() {
        return this.maxReconnectAttempts;
    }

    disconnect() {
        if (this.socket) {
            this.manualDisconnect = true;
            this.socket.disconnect();
            this.socket = null;
            this.connected = false;
            this.currentRoom = null;
            this.resumeIntent = null;
            this.pendingRejoin = false;
        }
    }

    createRoom(roomName, options = {}) {
        if (!this.socket || !this.connected) {
            console.error('Not connected to server');
            return;
        }
        const payload = {
            name: roomName,
            isPrivate: !!options.isPrivate,
            accessCode: options.isPrivate && options.accessCode
                ? String(options.accessCode).trim().toUpperCase()
                : null
        };
        this.socket.emit('create-room', payload);
    }

    joinRoom(roomId, accessCode = null) {
        if (!this.socket || !this.connected) {
            console.error('Not connected to server');
            return;
        }
        if (typeof roomId === 'object' && roomId !== null) {
            this.socket.emit('join-room', roomId);
            return;
        }

        this.socket.emit('join-room', { roomId, accessCode });
    }

    leaveRoom() {
        if (!this.socket || !this.connected) {
            console.error('Not connected to server');
            return;
        }
        this.socket.emit('leave-room');
    }

    kickPlayer(playerId) {
        if (!this.socket || !this.connected) {
            console.error('Not connected to server');
            return;
        }
        this.socket.emit('kick-player', playerId);
    }

    changeColor(color) {
        if (!this.socket || !this.connected) {
            console.error('Not connected to server');
            return;
        }
        this.socket.emit('change-color', color);
    }

    toggleReady() {
        if (!this.socket || !this.connected) {
            console.error('Not connected to server');
            return;
        }
        this.socket.emit('toggle-ready');
    }

    setNickname(nickname) {
        if (!this.socket || !this.connected) {
            console.error('Not connected to server');
            return;
        }
        this.socket.emit('set-nickname', nickname);
    }

    sendGameState(state) {
        if (!this.socket || !this.connected) {
            return;
        }
        this.socket.emit('game-state', state);
    }

    sendPlayerInput(input) {
        if (!this.socket || !this.connected) {
            return;
        }
        this.socket.emit('player-input', input);
    }

    requestSync() {
        if (!this.socket || !this.connected) {
            return;
        }
        this.socket.emit('request-sync');
    }

    on(event, callback) {
        const validEvents = {
            'connect': 'onConnect',
            'disconnect': 'onDisconnect',
            'sessionConfirmed': 'onSessionConfirmed',
            'roomsList': 'onRoomsList',
            'roomCreated': 'onRoomCreated',
            'roomJoined': 'onRoomJoined',
            'roomUpdate': 'onRoomUpdate',
            'leftRoom': 'onLeftRoom',
            'gameStart': 'onGameStart',
            'gameState': 'onGameState',
            'playerInput': 'onPlayerInput',
            'kicked': 'onPlayerKicked',
            'hostChanged': 'onHostChanged',
            'inputAck': 'onInputAck',
            'reconnecting': 'onReconnecting',
            'reconnected': 'onReconnected',
            'reconnectFailed': 'onReconnectFailed',
            'error': 'onError'
        };
        
        const callbackName = validEvents[event];
        if (callbackName && this.callbacks.hasOwnProperty(callbackName)) {
            this.callbacks[callbackName] = callback;
        } else {
            console.warn(`Unknown event type: ${event}`);
        }
    }
}

// Create global network manager instance
const networkManager = new NetworkManager();
