// Network manager for Blockies multiplayer
class NetworkManager {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.currentRoom = null;
        this.serverUrl = 'https://irgri.uk';
        this.callbacks = {
            onConnect: null,
            onDisconnect: null,
            onRoomsList: null,
            onRoomCreated: null,
            onRoomJoined: null,
            onRoomUpdate: null,
            onLeftRoom: null,
            onGameStart: null,
            onGameState: null,
            onPlayerInput: null,
            onError: null
        };
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
            if (this.callbacks.onConnect) {
                this.callbacks.onConnect();
            }
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.connected = false;
            if (this.callbacks.onDisconnect) {
                this.callbacks.onDisconnect();
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
            if (this.callbacks.onRoomCreated) {
                this.callbacks.onRoomCreated(room);
            }
        });

        this.socket.on('room-joined', (room) => {
            console.log('Room joined:', room);
            this.currentRoom = room;
            if (this.callbacks.onRoomJoined) {
                this.callbacks.onRoomJoined(room);
            }
        });

        this.socket.on('room-update', (room) => {
            console.log('Room updated:', room);
            this.currentRoom = room;
            if (this.callbacks.onRoomUpdate) {
                this.callbacks.onRoomUpdate(room);
            }
        });

        this.socket.on('left-room', () => {
            console.log('Left room');
            this.currentRoom = null;
            if (this.callbacks.onLeftRoom) {
                this.callbacks.onLeftRoom();
            }
        });

        this.socket.on('game-start', (data) => {
            console.log('Game starting:', data);
            if (this.callbacks.onGameStart) {
                this.callbacks.onGameStart(data);
            }
        });

        this.socket.on('game-state', (data) => {
            if (this.callbacks.onGameState) {
                this.callbacks.onGameState(data);
            }
        });

        this.socket.on('player-input', (data) => {
            if (this.callbacks.onPlayerInput) {
                this.callbacks.onPlayerInput(data);
            }
        });

        this.socket.on('error', (error) => {
            console.error('Server error:', error);
            if (this.callbacks.onError) {
                this.callbacks.onError(error.message);
            }
        });
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.connected = false;
            this.currentRoom = null;
        }
    }

    createRoom(roomName) {
        if (!this.socket || !this.connected) {
            console.error('Not connected to server');
            return;
        }
        this.socket.emit('create-room', { name: roomName });
    }

    joinRoom(roomId) {
        if (!this.socket || !this.connected) {
            console.error('Not connected to server');
            return;
        }
        this.socket.emit('join-room', roomId);
    }

    leaveRoom() {
        if (!this.socket || !this.connected) {
            console.error('Not connected to server');
            return;
        }
        this.socket.emit('leave-room');
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

    on(event, callback) {
        const validEvents = {
            'connect': 'onConnect',
            'disconnect': 'onDisconnect',
            'roomsList': 'onRoomsList',
            'roomCreated': 'onRoomCreated',
            'roomJoined': 'onRoomJoined',
            'roomUpdate': 'onRoomUpdate',
            'leftRoom': 'onLeftRoom',
            'gameStart': 'onGameStart',
            'gameState': 'onGameState',
            'playerInput': 'onPlayerInput',
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
