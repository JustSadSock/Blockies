// Game Configuration
const BLOCK_SIZE = 25;
const BASE_BOARD_WIDTH = 10;
const BOARD_HEIGHT = 20;
const ADDITIONAL_COLUMNS_PER_PLAYER = 4;
const PREVIEW_SIZE = 4;

const BASE_LINE_SCORE = 100;
const STREAK_BONUS_STEP = 0.1;
const MULTI_LINE_BONUS_STEP = 0.2;

// Sound Manager - simple Web Audio API sounds
class SoundManager {
    constructor() {
        this.audioContext = null;
        this.enabled = true;
        this.initAudio();
    }

    initAudio() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.log('Web Audio API not supported');
            this.enabled = false;
        }
    }

    playTone(frequency, duration, volume = 0.1) {
        if (!this.enabled || !this.audioContext) return;

        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.frequency.value = frequency;
        oscillator.type = 'square';

        gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);

        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + duration);
    }

    move() {
        this.playTone(200, 0.05, 0.05);
    }

    rotate() {
        this.playTone(300, 0.08, 0.06);
    }

    drop() {
        this.playTone(150, 0.1, 0.08);
    }

    lineClear(count) {
        const baseFreq = 400;
        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                this.playTone(baseFreq + i * 100, 0.15, 0.1);
            }, i * 50);
        }
    }

    gameOver() {
        const frequencies = [300, 250, 200, 150];
        frequencies.forEach((freq, i) => {
            setTimeout(() => {
                this.playTone(freq, 0.2, 0.08);
            }, i * 100);
        });
    }
}

const soundManager = new SoundManager();

// Tetromino shapes
const SHAPES = {
    I: [[1, 1, 1, 1]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1]],
    S: [[0, 1, 1], [1, 1, 0]],
    Z: [[1, 1, 0], [0, 1, 1]],
    J: [[1, 0, 0], [1, 1, 1]],
    L: [[0, 0, 1], [1, 1, 1]]
};

// Default colors for players - Retro-futurism palette
const DEFAULT_COLORS = ['#FF1493', '#00D9FF', '#FFDB58', '#39FF14'];

// Default key bindings for players (keyboard layout agnostic using code values)
const DEFAULT_KEYS = [
    { left: 'ArrowLeft', right: 'ArrowRight', down: 'ArrowDown', rotate: 'ArrowUp', drop: 'Space' },
    { left: 'KeyA', right: 'KeyD', down: 'KeyS', rotate: 'KeyW', drop: 'KeyQ' },
    { left: 'KeyJ', right: 'KeyL', down: 'KeyK', rotate: 'KeyI', drop: 'KeyU' },
    { left: 'KeyF', right: 'KeyH', down: 'KeyG', rotate: 'KeyT', drop: 'KeyR' }
];

const TEAM_SCORE_TEMPLATE = {
    score: 0,
    lines: 0,
    level: 1,
    comboChain: 0,
    lastClearDetail: null
};

function computeBoardWidth(numPlayers) {
    const players = Math.max(1, numPlayers || 1);
    return BASE_BOARD_WIDTH + (players - 1) * ADDITIONAL_COLUMNS_PER_PLAYER;
}

function getBoardWidth() {
    return gameState.boardWidth || BASE_BOARD_WIDTH;
}

function createEmptyBoard(width = getBoardWidth(), height = BOARD_HEIGHT) {
    return Array.from({ length: height }, () => Array(width).fill(0));
}

// Game State
let gameState = {
    players: [],
    numPlayers: 1,
    board: [],
    lastTime: 0,
    isPaused: false,
    isGameOver: false,
    boardWidth: BASE_BOARD_WIDTH,
    sharedStats: { ...TEAM_SCORE_TEMPLATE },
    sharedStatsDirty: false,
    inputStates: new Map(),
    settings: {
        colors: [...DEFAULT_COLORS],
        keys: JSON.parse(JSON.stringify(DEFAULT_KEYS))
    },
    gamepads: {
        connected: [],
        assignments: {}, // gamepadIndex -> playerIndex
        buttonStates: new Map() // gamepadIndex -> button states
    }
};

// Gamepad configuration
const GAMEPAD_DEADZONE = 0.5; // Increased deadzone to reduce sensitivity
const GAMEPAD_BUTTON_MAP = {
    left: [14], // D-pad left
    right: [15], // D-pad right
    down: [13], // D-pad down
    rotate: [0, 2], // A button (Xbox) or X button (PlayStation), X button (Xbox) or Square (PlayStation)
    drop: [1, 3] // B button (Xbox) or Circle (PlayStation), Y button (Xbox) or Triangle (PlayStation)
};

function scanGamepads() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const connected = [];
    
    for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]) {
            connected.push({
                index: i,
                id: gamepads[i].id,
                buttons: gamepads[i].buttons.length,
                axes: gamepads[i].axes.length
            });
        }
    }
    
    gameState.gamepads.connected = connected;
    return connected;
}

function createGamepadButtonState() {
    return {
        left: { pressed: false, wasPressed: false },
        right: { pressed: false, wasPressed: false },
        down: { pressed: false, wasPressed: false },
        rotate: { pressed: false, wasPressed: false },
        drop: { pressed: false, wasPressed: false }
    };
}

function resetSharedStats() {
    gameState.sharedStats = { ...TEAM_SCORE_TEMPLATE };
    gameState.sharedStatsDirty = true;
}

function formatKeyLabel(code) {
    if (!code) return '';

    const arrowMap = {
        ArrowLeft: '←',
        ArrowRight: '→',
        ArrowUp: '↑',
        ArrowDown: '↓'
    };

    if (arrowMap[code]) {
        return arrowMap[code];
    }

    if (code === 'Space') {
        return 'Space';
    }

    if (code.startsWith('Key')) {
        return code.replace('Key', '');
    }

    if (code.startsWith('Digit')) {
        return code.replace('Digit', '');
    }

    return code;
}

function normalizeKeyCode(value) {
    if (!value) return '';

    if (value === ' ') {
        return 'Space';
    }

    if (/^Arrow(Left|Right|Up|Down)$/.test(value)) {
        return value;
    }

    if (/^Key[A-Z]$/.test(value)) {
        return value;
    }

    if (/^Digit[0-9]$/.test(value)) {
        return value;
    }

    if (value.length === 1) {
        const upper = value.toUpperCase();
        if (upper >= 'A' && upper <= 'Z') {
            return `Key${upper}`;
        }

        if (/^[0-9]$/.test(value)) {
            return `Digit${value}`;
        }
    }

    return value;
}

function formatNumber(value) {
    return Number(value || 0).toLocaleString('en-US');
}

function createActionState() {
    return {
        active: false,
        heldTime: 0,
        hasFiredInitial: false
    };
}

// Player Class
class Player {
    constructor(id, color, keys, spawnAnchor) {
        this.id = id;
        this.color = color;
        this.keys = keys;
        this.score = 0;
        this.level = 1;
        this.lines = 0;
        this.currentPiece = null;
        this.nextPiece = null;
        this.position = { x: 0, y: 0 };
        this.gameOver = false;
        this.dropCounter = 0;
        this.dropInterval = 1000;
        this.lastTime = 0;
        this.spawnAnchor = typeof spawnAnchor === 'number' ? spawnAnchor : getBoardWidth() / 2;
    }

    init() {
        this.nextPiece = this.randomPiece();
        this.spawnPiece();
    }

    randomPiece() {
        const shapes = Object.keys(SHAPES);
        const shape = shapes[Math.floor(Math.random() * shapes.length)];
        return SHAPES[shape];
    }

    spawnPiece() {
        this.currentPiece = this.nextPiece;
        this.nextPiece = this.randomPiece();
        const pieceWidth = this.currentPiece[0].length;
        const boardWidth = getBoardWidth();
        const preferredX = Math.min(
            boardWidth - pieceWidth,
            Math.max(0, Math.round(this.spawnAnchor - pieceWidth / 2))
        );

        let spawnPosition = null;
        const checked = new Set();

        for (let offset = 0; offset < boardWidth; offset++) {
            const candidates = [];
            if (offset === 0) {
                candidates.push(preferredX);
            } else {
                const left = preferredX - offset;
                const right = preferredX + offset;

                if (left >= 0) candidates.push(left);
                if (right <= boardWidth - pieceWidth) candidates.push(right);
            }

            for (const candidate of candidates) {
                if (checked.has(candidate)) continue;
                checked.add(candidate);

                if (!this.checkCollision(this.currentPiece, { x: candidate, y: 0 }).collides) {
                    spawnPosition = { x: candidate, y: 0 };
                    break;
                }
            }

            if (spawnPosition) break;
        }

        this.position = spawnPosition || { x: preferredX, y: 0 };

        if (!spawnPosition && this.checkCollision().collides) {
            this.gameOver = true;
            checkAllPlayersGameOver();
        }

        this.dropCounter = 0;
    }

    checkCollision(piece = this.currentPiece, pos = this.position) {
        const result = {
            collides: false,
            withLocked: false,
            withActive: false
        };

        for (let y = 0; y < piece.length; y++) {
            for (let x = 0; x < piece[y].length; x++) {
                if (!piece[y][x]) continue;

                const boardX = pos.x + x;
                const boardY = pos.y + y;
                const boardWidth = getBoardWidth();

                if (boardX < 0 || boardX >= boardWidth || boardY >= BOARD_HEIGHT) {
                    result.collides = true;
                    result.withLocked = true;
                    return result;
                }

                if (boardY < 0) continue;

                if (gameState.board[boardY][boardX]) {
                    result.collides = true;
                    result.withLocked = true;
                    return result;
                }

                if (isCellOccupiedByOtherPiece(boardX, boardY, this.id)) {
                    result.collides = true;
                    result.withActive = true;
                }
            }
        }

        return result;
    }

    move(dir) {
        this.position.x += dir;
        if (this.checkCollision().collides) {
            this.position.x -= dir;
        } else {
            soundManager.move();
            // Send online update if in online game
            if (typeof networkManager !== 'undefined' && networkManager.connected) {
                networkManager.sendPlayerInput({ action: 'move', direction: dir });
            }
        }
    }

    rotate() {
        const rotated = this.currentPiece[0].map((_, i) =>
            this.currentPiece.map(row => row[i]).reverse()
        );

        if (!this.checkCollision(rotated).collides) {
            this.currentPiece = rotated;
            soundManager.rotate();
            // Send online update if in online game
            if (typeof networkManager !== 'undefined' && networkManager.connected) {
                networkManager.sendPlayerInput({ action: 'rotate' });
            }
        }
    }

    drop() {
        this.position.y++;
        const collision = this.checkCollision();
        if (collision.collides) {
            this.position.y--;
            if (collision.withLocked) {
                this.merge();
                soundManager.drop();
                this.clearLines();
                this.spawnPiece();
            }
        }
        this.dropCounter = 0;
        // Send online update if in online game
        if (typeof networkManager !== 'undefined' && networkManager.connected) {
            networkManager.sendPlayerInput({ action: 'drop' });
        }
    }

    hardDrop() {
        let maxDrops = BOARD_HEIGHT; // Safety limit
        let landedOnLocked = false;

        while (maxDrops > 0) {
            this.position.y++;
            maxDrops--;

            const collision = this.checkCollision();
            if (!collision.collides) {
                continue;
            }

            if (collision.withLocked) {
                landedOnLocked = true;
            }

            this.position.y--;
            break;
        }

        if (landedOnLocked) {
            this.merge();
            soundManager.drop();
            this.clearLines();
            this.spawnPiece();
        }
        this.dropCounter = 0;
        // Send online update if in online game
        if (typeof networkManager !== 'undefined' && networkManager.connected) {
            networkManager.sendPlayerInput({ action: 'hardDrop' });
        }
    }

    merge() {
        for (let y = 0; y < this.currentPiece.length; y++) {
            for (let x = 0; x < this.currentPiece[y].length; x++) {
                if (this.currentPiece[y][x]) {
                    const boardY = this.position.y + y;
                    const boardX = this.position.x + x;
                    if (boardY >= 0) {
                        gameState.board[boardY][boardX] = this.id + 1;
                    }
                }
            }
        }
    }

    clearLines() {
        let linesCleared = 0;

        const boardWidth = getBoardWidth();
        for (let y = BOARD_HEIGHT - 1; y >= 0; y--) {
            if (gameState.board[y].every(cell => cell !== 0)) {
                gameState.board.splice(y, 1);
                gameState.board.unshift(Array(boardWidth).fill(0));
                linesCleared++;
                y++; // Check the same row again
            }
        }

        if (linesCleared === 0) {
            if (gameState.sharedStats.comboChain !== 0) {
                gameState.sharedStats.comboChain = 0;
                gameState.sharedStatsDirty = true;
            }
            gameState.sharedStats.lastClearDetail = null;
            return;
        }

        // Play line clear sound
        soundManager.lineClear(linesCleared);

        const comboStep = gameState.sharedStats.comboChain || 0;
        const comboMultiplier = 1 + STREAK_BONUS_STEP * comboStep;
        const multiMultiplier = 1 + MULTI_LINE_BONUS_STEP * (linesCleared - 1);
        const perLineScore = Math.round(BASE_LINE_SCORE * comboMultiplier * multiMultiplier);
        const gained = perLineScore * linesCleared;

        const streakBonusPercent = Math.round((comboMultiplier - 1) * 100);
        const multiBonusPercent = Math.round((multiMultiplier - 1) * 100);

        gameState.sharedStats.lines += linesCleared;
        gameState.sharedStats.score += gained;
        gameState.sharedStats.level = Math.floor(gameState.sharedStats.lines / 10) + 1;
        gameState.sharedStats.comboChain = comboStep + 1;
        gameState.sharedStats.lastClearDetail = {
            linesCleared,
            totalScore: gained,
            perLineScore,
            basePerLine: BASE_LINE_SCORE,
            comboChain: gameState.sharedStats.comboChain,
            comboMultiplier,
            multiMultiplier,
            streakBonusPercent,
            multiBonusPercent
        };

        this.lines = gameState.sharedStats.lines;
        this.score = gameState.sharedStats.score;
        this.level = gameState.sharedStats.level;

        gameState.players.forEach(player => {
            player.dropInterval = Math.max(100, player.dropInterval * Math.pow(0.95, linesCleared));
            player.lines = gameState.sharedStats.lines;
            player.score = gameState.sharedStats.score;
            player.level = gameState.sharedStats.level;
        });

        gameState.sharedStatsDirty = true;
    }

    update(deltaTime) {
        if (this.gameOver) return;

        this.dropCounter += deltaTime;
        if (this.dropCounter > this.dropInterval) {
            this.drop();
        }
    }
}

function isCellOccupiedByOtherPiece(x, y, currentPlayerId) {
    return gameState.players.some(player => {
        if (player.id === currentPlayerId || player.gameOver || !player.currentPiece) {
            return false;
        }

        for (let py = 0; py < player.currentPiece.length; py++) {
            for (let px = 0; px < player.currentPiece[py].length; px++) {
                if (!player.currentPiece[py][px]) continue;
                const boardX = player.position.x + px;
                const boardY = player.position.y + py;

                if (boardX === x && boardY === y) {
                    return true;
                }
            }
        }

        return false;
    });
}

function checkAllPlayersGameOver() {
    if (!gameState.players.length) return;

    if (gameState.players.every(player => player.gameOver)) {
        gameState.isGameOver = true;
        soundManager.gameOver();
    }
}

// UI Manager
class UIManager {
    constructor() {
        this.screens = {
            mainMenu: document.getElementById('main-menu'),
            coopSetup: document.getElementById('coop-setup-screen'),
            onlineLobby: document.getElementById('online-lobby-screen'),
            gameScreen: document.getElementById('game-screen'),
            settingsScreen: document.getElementById('settings-screen')
        };

        this.modals = {
            pause: document.getElementById('pause-menu'),
            gameOver: document.getElementById('gameover-menu')
        };

        this.touchControls = document.getElementById('touch-controls');
        this.touchStatus = document.getElementById('touch-status');
        this.touchPlayerIndex = 0;
        this.teamStats = document.getElementById('team-stats');
        this.scoreCard = document.getElementById('team-score-card');
        this.comboIndicator = document.getElementById('combo-indicator');
        this.comboLabel = document.getElementById('combo-label');
        this.comboBonus = document.getElementById('combo-bonus');
        this.clearFeed = document.getElementById('clear-feed');
        this.pendingScaleFrame = null;
        this.lastComboChain = 0;
        this.previousScreen = 'mainMenu'; // Track previous screen for settings navigation

        this.moveRepeatInterval = 90;
        this.softDropInitialDelay = 0;
        this.softDropRepeatInterval = 55;

        this.setupEventListeners();
        this.initTouchControls();
        this.initGamepads();
        window.addEventListener('resize', () => this.handleResize());
    }

    initGamepads() {
        // Scan for gamepads initially
        scanGamepads();
        this.updateGamepadStatus();
        
        // Listen for gamepad connection events
        window.addEventListener('gamepadconnected', (e) => {
            console.log('Gamepad connected:', e.gamepad.id);
            scanGamepads();
            this.updateGamepadStatus();
        });
        
        window.addEventListener('gamepaddisconnected', (e) => {
            console.log('Gamepad disconnected:', e.gamepad.id);
            scanGamepads();
            this.updateGamepadStatus();
            // Remove assignments for this gamepad
            delete gameState.gamepads.assignments[e.gamepad.index];
            gameState.gamepads.buttonStates.delete(e.gamepad.index);
        });
    }
    
    updateGamepadStatus() {
        const statusEl = document.getElementById('gamepad-status');
        if (!statusEl) return;
        
        const count = gameState.gamepads.connected.length;
        if (count > 0) {
            statusEl.textContent = `🎮 ${count} Gamepad${count > 1 ? 's' : ''}`;
            statusEl.style.display = 'block';
        } else {
            statusEl.style.display = 'none';
        }
    }

    pollGamepads() {
        if (!navigator.getGamepads) return;
        
        const gamepads = navigator.getGamepads();
        
        for (let i = 0; i < gamepads.length; i++) {
            const gamepad = gamepads[i];
            if (!gamepad) continue;
            
            // Check if this gamepad is assigned to a player
            const playerIndex = gameState.gamepads.assignments[i];
            if (playerIndex === undefined) continue;
            
            const player = gameState.players[playerIndex];
            if (!player || player.gameOver) continue;
            
            // Get or create button state for this gamepad
            if (!gameState.gamepads.buttonStates.has(i)) {
                gameState.gamepads.buttonStates.set(i, createGamepadButtonState());
            }
            const buttonState = gameState.gamepads.buttonStates.get(i);
            
            // Check D-pad buttons for each action
            for (const action in GAMEPAD_BUTTON_MAP) {
                const buttons = GAMEPAD_BUTTON_MAP[action];
                const pressed = buttons.some(btnIndex => gamepad.buttons[btnIndex]?.pressed);
                
                const wasPressed = buttonState[action].wasPressed;
                buttonState[action].pressed = pressed;
                
                // Trigger on button press (not held) - similar to keyboard behavior
                if (pressed && !wasPressed) {
                    this.handleGamepadAction(player, action);
                }
                
                buttonState[action].wasPressed = pressed;
            }
        }
    }

    handleGamepadAction(player, action) {
        switch (action) {
            case 'left':
                player.move(-1);
                break;
            case 'right':
                player.move(1);
                break;
            case 'down':
                player.drop();
                break;
            case 'rotate':
                player.rotate();
                break;
            case 'drop':
                player.hardDrop();
                break;
        }
    }

    setupEventListeners() {
        // Mode selection - new menu structure
        document.getElementById('mode-single').addEventListener('click', () => this.startGame(1));
        document.getElementById('mode-local').addEventListener('click', () => this.showCoopSetup());
        document.getElementById('mode-online').addEventListener('click', () => this.showOnlineLobby());

        // Co-op setup
        document.querySelectorAll('.player-count-btn').forEach(btn => {
            btn.addEventListener('click', () => this.selectPlayerCount(btn));
        });
        document.getElementById('start-coop-btn').addEventListener('click', () => this.startCoopGame());
        document.getElementById('cancel-coop-btn').addEventListener('click', () => this.showScreen('mainMenu'));

        // Online lobby
        document.getElementById('back-from-online-btn').addEventListener('click', () => this.showScreen('mainMenu'));
        document.getElementById('create-room-btn').addEventListener('click', () => this.createRoom());
        const leaveRoomBtn = document.getElementById('leave-room-btn');
        if (leaveRoomBtn) {
            leaveRoomBtn.addEventListener('click', () => this.leaveRoom());
        }
        const readyBtn = document.getElementById('ready-btn');
        if (readyBtn) {
            readyBtn.addEventListener('click', () => this.toggleReady());
        }

        // Settings
        document.getElementById('settings-btn').addEventListener('click', () => this.showSettings());
        document.getElementById('save-settings-btn').addEventListener('click', () => this.saveSettings());
        document.getElementById('cancel-settings-btn').addEventListener('click', () => this.hideSettings());

        // Game controls - now in header
        const pauseBtn = document.getElementById('pause-btn');
        const quitBtn = document.getElementById('quit-btn');
        if (pauseBtn) pauseBtn.addEventListener('click', () => this.togglePause());
        if (quitBtn) quitBtn.addEventListener('click', () => this.quitToMenu());

        // Pause menu
        document.getElementById('resume-btn').addEventListener('click', () => this.togglePause());
        document.getElementById('restart-btn').addEventListener('click', () => this.restart());
        document.getElementById('quit-to-menu-btn').addEventListener('click', () => this.quitToMenu());

        // Game over menu
        document.getElementById('play-again-btn').addEventListener('click', () => this.restart());
        document.getElementById('menu-btn').addEventListener('click', () => this.quitToMenu());

        // Keyboard input
        document.addEventListener('keydown', (e) => this.handleKeyPress(e));
        document.addEventListener('keyup', (e) => this.handleKeyRelease(e));
    }

    initTouchControls() {
        if (!this.touchControls) return;

        const buttons = this.touchControls.querySelectorAll('[data-action]');
        buttons.forEach(button => {
            const action = button.dataset.action;
            if (!action) return;

            const handler = (event) => {
                event.preventDefault();
                this.handleTouchAction(action);
            };

            if (window.PointerEvent) {
                button.addEventListener('pointerdown', handler);
            } else {
                button.addEventListener('touchstart', handler, { passive: false });
                button.addEventListener('mousedown', handler);
            }

            button.addEventListener('click', (event) => {
                if (event.detail === 0) {
                    handler(event);
                }
            });
            button.addEventListener('contextmenu', (event) => event.preventDefault());
        });

        if (this.touchStatus) {
            this.touchStatus.textContent = 'Start a game to use touch controls';
        }
    }

    refreshTouchStatus() {
        if (!this.touchControls || !this.touchStatus) return;

        const activePlayer = this.getTouchPlayer();
        if (activePlayer && !gameState.isGameOver) {
            this.touchStatus.textContent = `Touch controls: Player ${activePlayer.id + 1}`;
        } else if (gameState.players.length && gameState.players.every(player => player.gameOver)) {
            this.touchStatus.textContent = 'All players have finished';
        } else {
            this.touchStatus.textContent = 'Start a game to use touch controls';
        }
    }

    getTouchPlayer() {
        if (!gameState.players.length) {
            return null;
        }

        const current = gameState.players[this.touchPlayerIndex];
        if (current && !current.gameOver) {
            return current;
        }

        const fallback = gameState.players.find(player => !player.gameOver);
        if (fallback) {
            this.touchPlayerIndex = fallback.id;
            return fallback;
        }

        return null;
    }

    handleTouchAction(action) {
        if (gameState.isPaused || gameState.isGameOver) {
            return;
        }

        const player = this.getTouchPlayer();
        if (!player) {
            this.refreshTouchStatus();
            return;
        }

        let requiresInfoUpdate = false;

        switch (action) {
            case 'left':
                player.move(-1);
                break;
            case 'right':
                player.move(1);
                break;
            case 'down':
                player.drop();
                requiresInfoUpdate = true;
                break;
            case 'rotate':
                player.rotate();
                break;
            case 'drop':
                player.hardDrop();
                requiresInfoUpdate = true;
                break;
            default:
                break;
        }

        if (requiresInfoUpdate) {
            this.updatePlayerInfo(player);
            this.drawNextPiece(player);
        }

        this.drawBoard();
        this.updateTeamStatsIfNeeded();

        if (player.gameOver) {
            this.refreshTouchStatus();
        }
    }

    showScreen(screenName) {
        // Track previous screen for settings navigation
        const currentScreen = Object.keys(this.screens).find(key => 
            this.screens[key].classList.contains('active')
        );
        if (currentScreen && screenName === 'settingsScreen') {
            this.previousScreen = currentScreen;
        }
        
        Object.values(this.screens).forEach(screen => screen.classList.remove('active'));
        this.screens[screenName].classList.add('active');

        // Show/hide header buttons based on screen
        const pauseBtn = document.getElementById('pause-btn');
        const quitBtn = document.getElementById('quit-btn');
        if (pauseBtn && quitBtn) {
            if (screenName === 'gameScreen') {
                pauseBtn.style.display = 'inline-flex';
                quitBtn.style.display = 'inline-flex';
            } else {
                pauseBtn.style.display = 'none';
                quitBtn.style.display = 'none';
            }
        }

        if (screenName === 'gameScreen') {
            this.updateLayoutDensity();
            this.scheduleBoardScaleUpdate();
        }

        const teamStats = document.getElementById('team-stats');
        if (teamStats) {
            if (screenName === 'gameScreen') {
                teamStats.classList.add('visible');
                this.updateTeamStats();
            } else {
                teamStats.classList.remove('visible');
                this.resetTeamStatsDisplay();
            }
        }

        if (this.touchControls) {
            if (screenName === 'gameScreen') {
                this.touchControls.classList.add('visible');
                this.refreshTouchStatus();
            } else {
                this.touchControls.classList.remove('visible');
                if (this.touchStatus) {
                    this.touchStatus.textContent = 'Start a game to use touch controls';
                }
            }
        }
    }

    showModal(modalName) {
        this.modals[modalName].classList.add('active');
    }

    hideModal(modalName) {
        this.modals[modalName].classList.remove('active');
    }

    startGame(numPlayers) {
        gameState.numPlayers = numPlayers;
        gameState.isPaused = false;
        gameState.isGameOver = false;
        gameState.players = [];
        gameState.boardWidth = computeBoardWidth(numPlayers);
        gameState.board = createEmptyBoard(gameState.boardWidth, BOARD_HEIGHT);
        gameState.lastTime = 0;
        this.touchPlayerIndex = 0;
        gameState.inputStates = new Map();
        resetSharedStats();

        const container = document.getElementById('game-container');
        container.innerHTML = '';
        
        const nextPiecesPreview = document.getElementById('next-pieces-preview');
        if (nextPiecesPreview) {
            nextPiecesPreview.innerHTML = '';
        }
        
        const playerInfoSidebar = document.getElementById('player-info-sidebar');
        if (playerInfoSidebar) {
            playerInfoSidebar.innerHTML = '';
        }

        if (this.clearFeed) {
            this.clearFeed.innerHTML = '';
        }
        this.lastComboChain = 0;
        this.updateComboIndicator();

        const boardWrapper = document.createElement('div');
        boardWrapper.id = 'shared-board';

        const canvas = document.createElement('canvas');
        canvas.id = 'game-canvas';
        canvas.width = gameState.boardWidth * BLOCK_SIZE;
        canvas.height = BOARD_HEIGHT * BLOCK_SIZE;
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        canvas.style.maxWidth = `${canvas.width}px`;
        canvas.style.maxHeight = `${canvas.height}px`;
        boardWrapper.style.setProperty('--board-max-width', `${canvas.width}px`);
        boardWrapper.appendChild(canvas);

        container.appendChild(boardWrapper);

        for (let i = 0; i < numPlayers; i++) {
            const spawnAnchor = ((i + 1) / (numPlayers + 1)) * gameState.boardWidth;
            const player = new Player(
                i,
                gameState.settings.colors[i],
                gameState.settings.keys[i],
                spawnAnchor
            );
            player.init();
            player.score = gameState.sharedStats.score;
            player.level = gameState.sharedStats.level;
            player.lines = gameState.sharedStats.lines;
            gameState.players.push(player);
            gameState.inputStates.set(player.id, {
                left: createActionState(),
                right: createActionState(),
                down: createActionState()
            });

            this.createPlayerInfo(player, playerInfoSidebar);
            this.createNextPiecePreview(player, nextPiecesPreview);
            this.updatePlayerInfo(player);
            this.drawNextPiece(player);
        }

        if (nextPiecesPreview && numPlayers > 0) {
            nextPiecesPreview.classList.add('visible');
        }
        
        if (playerInfoSidebar && numPlayers > 0) {
            playerInfoSidebar.classList.add('visible');
        }

        this.drawBoard();

        this.showScreen('gameScreen');
        this.refreshTouchStatus();
        this.scheduleBoardScaleUpdate();
        requestAnimationFrame((time) => this.gameLoop(time));
    }
    
    createNextPiecePreview(player, container) {
        if (!container) return;
        
        const item = document.createElement('div');
        item.className = 'next-piece-item';
        item.id = `next-item-${player.id}`;
        
        const nextCanvas = document.createElement('canvas');
        nextCanvas.id = `next-${player.id}`;
        nextCanvas.width = PREVIEW_SIZE * BLOCK_SIZE;
        nextCanvas.height = PREVIEW_SIZE * BLOCK_SIZE;
        item.appendChild(nextCanvas);
        
        container.appendChild(item);
    }

    createPlayerInfo(player, container) {
        if (!container) return;
        
        const preview = document.createElement('div');
        preview.className = 'player-preview';
        preview.id = `player-${player.id}`;

        const header = document.createElement('div');
        header.className = 'preview-header';
        header.style.setProperty('--player-color', player.color);
        header.innerHTML = `
            <span class="preview-badge" style="background:${player.color}"></span>
            Player ${player.id + 1}
        `;

        const status = document.createElement('div');
        status.className = 'preview-status';
        status.id = `status-${player.id}`;
        status.textContent = 'In play';

        preview.appendChild(header);
        preview.appendChild(status);
        container.appendChild(preview);
    }

    gameLoop(time) {
        if (gameState.isGameOver) {
            this.refreshTouchStatus();
            this.showGameOver();
            return;
        }

        if (!gameState.isPaused) {
            const deltaTime = time - (gameState.lastTime || time);
            gameState.lastTime = time;

            // Poll gamepads
            this.pollGamepads();

            let touchStatusNeedsUpdate = false;
            gameState.players.forEach(player => {
                const wasGameOver = player.gameOver;

                if (!player.gameOver) {
                    player.update(deltaTime);
                    this.applyContinuousInputs(player, deltaTime);
                    this.updatePlayerInfo(player);
                    this.drawNextPiece(player);
                }

                if (!wasGameOver && player.gameOver) {
                    touchStatusNeedsUpdate = true;
                }
            });

            this.drawBoard();
            this.updateTeamStatsIfNeeded();

            if (touchStatusNeedsUpdate) {
                this.refreshTouchStatus();
            }
        }

        requestAnimationFrame((time) => this.gameLoop(time));
    }

    drawBoard() {
        const canvas = document.getElementById('game-canvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const boardWidth = getBoardWidth();
        
        // Dark background with subtle grid
        ctx.fillStyle = '#0a0515';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw locked blocks with retro styling
        for (let y = 0; y < BOARD_HEIGHT; y++) {
            for (let x = 0; x < boardWidth; x++) {
                const occupant = gameState.board[y][x];
                if (occupant) {
                    const player = gameState.players[occupant - 1];
                    const color = player ? player.color : '#333';
                    
                    // Main block with gradient
                    const gradient = ctx.createLinearGradient(
                        x * BLOCK_SIZE, y * BLOCK_SIZE,
                        x * BLOCK_SIZE, (y + 1) * BLOCK_SIZE
                    );
                    gradient.addColorStop(0, color);
                    gradient.addColorStop(1, this.darkenColor(color, 0.3));
                    ctx.fillStyle = gradient;
                    ctx.fillRect(x * BLOCK_SIZE, y * BLOCK_SIZE, BLOCK_SIZE - 2, BLOCK_SIZE - 2);

                    // Highlight
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
                    ctx.fillRect(x * BLOCK_SIZE + 2, y * BLOCK_SIZE + 2, BLOCK_SIZE - 6, 3);
                    
                    // Border
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
                    ctx.lineWidth = 2;
                    ctx.strokeRect(x * BLOCK_SIZE, y * BLOCK_SIZE, BLOCK_SIZE - 2, BLOCK_SIZE - 2);
                }
            }
        }

        // Draw active pieces with glow
        gameState.players.forEach(player => {
            if (!player.currentPiece || player.gameOver) return;

            for (let y = 0; y < player.currentPiece.length; y++) {
                for (let x = 0; x < player.currentPiece[y].length; x++) {
                    if (player.currentPiece[y][x]) {
                        const drawX = (player.position.x + x) * BLOCK_SIZE;
                        const drawY = (player.position.y + y) * BLOCK_SIZE;
                        
                        // Glow effect
                        ctx.shadowColor = player.color;
                        ctx.shadowBlur = 8;
                        
                        // Main block with gradient
                        const gradient = ctx.createLinearGradient(
                            drawX, drawY,
                            drawX, drawY + BLOCK_SIZE
                        );
                        gradient.addColorStop(0, player.color);
                        gradient.addColorStop(1, this.darkenColor(player.color, 0.3));
                        ctx.fillStyle = gradient;
                        ctx.fillRect(drawX, drawY, BLOCK_SIZE - 2, BLOCK_SIZE - 2);
                        
                        ctx.shadowBlur = 0;

                        // Highlight
                        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                        ctx.fillRect(drawX + 2, drawY + 2, BLOCK_SIZE - 6, 3);
                        
                        // Border
                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                        ctx.lineWidth = 2;
                        ctx.strokeRect(drawX, drawY, BLOCK_SIZE - 2, BLOCK_SIZE - 2);
                    }
                }
            }
        });
    }
    
    darkenColor(color, amount) {
        // Parse hex color and darken it
        if (!color || typeof color !== 'string' || !color.startsWith('#')) {
            return '#000000';
        }
        
        let r = parseInt(color.slice(1, 3), 16);
        let g = parseInt(color.slice(3, 5), 16);
        let b = parseInt(color.slice(5, 7), 16);
        
        if (isNaN(r) || isNaN(g) || isNaN(b)) {
            return color;
        }
        
        r = Math.max(0, Math.floor(r * (1 - amount)));
        g = Math.max(0, Math.floor(g * (1 - amount)));
        b = Math.max(0, Math.floor(b * (1 - amount)));
        
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    drawNextPiece(player) {
        const nextCanvas = document.getElementById(`next-${player.id}`);
        if (!nextCanvas) return;

        const nextCtx = nextCanvas.getContext('2d');
        nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);

        if (player.nextPiece) {
            const offsetX = Math.floor((PREVIEW_SIZE - player.nextPiece[0].length) / 2);
            const offsetY = Math.floor((PREVIEW_SIZE - player.nextPiece.length) / 2);

            for (let y = 0; y < player.nextPiece.length; y++) {
                for (let x = 0; x < player.nextPiece[y].length; x++) {
                    if (player.nextPiece[y][x]) {
                        const drawX = (offsetX + x) * BLOCK_SIZE;
                        const drawY = (offsetY + y) * BLOCK_SIZE;
                        
                        // Glow effect
                        nextCtx.shadowColor = player.color;
                        nextCtx.shadowBlur = 6;
                        
                        // Main block with gradient
                        const gradient = nextCtx.createLinearGradient(
                            drawX, drawY,
                            drawX, drawY + BLOCK_SIZE
                        );
                        gradient.addColorStop(0, player.color);
                        gradient.addColorStop(1, this.darkenColor(player.color, 0.3));
                        nextCtx.fillStyle = gradient;
                        nextCtx.fillRect(drawX, drawY, BLOCK_SIZE - 2, BLOCK_SIZE - 2);
                        
                        nextCtx.shadowBlur = 0;

                        // Highlight
                        nextCtx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                        nextCtx.fillRect(drawX + 2, drawY + 2, BLOCK_SIZE - 6, 3);
                        
                        // Border
                        nextCtx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
                        nextCtx.lineWidth = 2;
                        nextCtx.strokeRect(drawX, drawY, BLOCK_SIZE - 2, BLOCK_SIZE - 2);
                    }
                }
            }
        }
    }

    updatePlayerInfo(player) {
        const statusEl = document.getElementById(`status-${player.id}`);
        if (!statusEl) return;

        if (player.gameOver) {
            statusEl.textContent = 'Out';
            statusEl.classList.add('is-out');
        } else {
            statusEl.textContent = 'In play';
            statusEl.classList.remove('is-out');
        }
    }

    updateTeamStats() {
        const { score, lines } = gameState.sharedStats;
        const scoreEl = document.getElementById('team-score');
        const linesEl = document.getElementById('team-lines');

        if (scoreEl) scoreEl.textContent = formatNumber(score);
        if (linesEl) linesEl.textContent = `${formatNumber(lines)} lines`;

        this.updateComboIndicator();
        this.scheduleBoardScaleUpdate();
    }

    resetTeamStatsDisplay() {
        const scoreEl = document.getElementById('team-score');
        const linesEl = document.getElementById('team-lines');

        if (scoreEl) scoreEl.textContent = '0';
        if (linesEl) linesEl.textContent = '0 lines';

        if (this.comboIndicator) {
            this.comboIndicator.classList.remove('visible');
        }
        if (this.clearFeed) {
            this.clearFeed.innerHTML = '';
        }
        if (this.scoreCard) {
            this.scoreCard.classList.remove('score-card--pulse');
        }
        this.lastComboChain = 0;
    }

    updateTeamStatsIfNeeded() {
        if (!gameState.sharedStatsDirty) {
            return;
        }

        this.updateTeamStats();

        const detail = gameState.sharedStats.lastClearDetail;
        if (detail) {
            this.showLineClearCelebration(detail);
            gameState.sharedStats.lastClearDetail = null;
        }

        gameState.sharedStatsDirty = false;
    }

    updateComboIndicator() {
        if (!this.comboIndicator) return;

        const chain = gameState.sharedStats.comboChain || 0;
        if (chain > 1) {
            this.comboIndicator.classList.add('visible');
            if (this.comboLabel) {
                this.comboLabel.textContent = `Combo x${chain}`;
            }
            if (this.comboBonus) {
                const bonusPercent = (chain - 1) * 10;
                this.comboBonus.textContent = `+${bonusPercent}% streak`;
            }

            if (chain !== this.lastComboChain) {
                this.comboIndicator.classList.remove('combo-burst');
                void this.comboIndicator.offsetWidth;
                this.comboIndicator.classList.add('combo-burst');
            }
        } else {
            this.comboIndicator.classList.remove('visible');
            this.comboIndicator.classList.remove('combo-burst');
            if (this.comboLabel) {
                this.comboLabel.textContent = 'Combo ready';
            }
            if (this.comboBonus) {
                this.comboBonus.textContent = '';
            }
        }

        this.lastComboChain = chain;
        this.scheduleBoardScaleUpdate();
    }

    flashScoreCard() {
        if (!this.scoreCard) return;

        this.scoreCard.classList.remove('score-card--pulse');
        void this.scoreCard.offsetWidth;
        this.scoreCard.classList.add('score-card--pulse');
    }

    getLineClearTitle(linesCleared) {
        switch (linesCleared) {
            case 1:
                return 'Line break';
            case 2:
                return 'Double break';
            case 3:
                return 'Triple break';
            default:
                return 'Mega clear';
        }
    }

    showLineClearCelebration(detail) {
        this.flashScoreCard();

        if (!this.clearFeed) return;

        const entry = document.createElement('div');
        entry.className = 'clear-event';

        const title = document.createElement('div');
        title.className = 'clear-event__title';
        title.textContent = this.getLineClearTitle(detail.linesCleared);
        entry.appendChild(title);

        const points = document.createElement('div');
        points.className = 'clear-event__points';
        points.textContent = `+${formatNumber(detail.totalScore)} pts`;
        entry.appendChild(points);

        const perLine = document.createElement('div');
        perLine.className = 'clear-event__per-line';
        perLine.textContent = `${formatNumber(detail.perLineScore)} pts / line`;
        entry.appendChild(perLine);

        const bonusChips = [];
        if (detail.multiMultiplier > 1) {
            bonusChips.push(`Multi +${detail.multiBonusPercent}%`);
        }
        if (detail.comboMultiplier > 1) {
            bonusChips.push(`Streak +${detail.streakBonusPercent}%`);
        }

        if (bonusChips.length) {
            const bonusRow = document.createElement('div');
            bonusRow.className = 'clear-event__bonuses';
            bonusChips.forEach(text => {
                const chip = document.createElement('span');
                chip.textContent = text;
                bonusRow.appendChild(chip);
            });
            entry.appendChild(bonusRow);
        }

        this.clearFeed.appendChild(entry);

        while (this.clearFeed.children.length > 4) {
            this.clearFeed.removeChild(this.clearFeed.firstChild);
        }

        requestAnimationFrame(() => {
            entry.classList.add('visible');
        });

        setTimeout(() => {
            entry.classList.add('clear-event--fade');
            setTimeout(() => {
                entry.remove();
                this.scheduleBoardScaleUpdate();
            }, 600);
        }, 3600);

        this.scheduleBoardScaleUpdate();
    }

    handleResize() {
        if (!this.screens.gameScreen.classList.contains('active')) {
            return;
        }

        this.updateLayoutDensity();
        this.updateBoardScale();
    }

    updateLayoutDensity() {
        const gameScreen = this.screens.gameScreen;
        if (!gameScreen) return;

        const compact = window.innerWidth < 980 || window.innerHeight < 720;
        gameScreen.classList.toggle('compact', compact);
    }

    scheduleBoardScaleUpdate() {
        if (this.pendingScaleFrame) return;

        this.pendingScaleFrame = requestAnimationFrame(() => {
            this.pendingScaleFrame = null;
            this.updateBoardScale();
        });
    }

    updateBoardScale() {
        const canvas = document.getElementById('game-canvas');
        const boardWrapper = document.getElementById('shared-board');
        if (!canvas || !boardWrapper) {
            return;
        }

        const boardWidth = canvas.width;
        const boardHeight = canvas.height;

        const parentRect = boardWrapper.parentElement ? boardWrapper.parentElement.getBoundingClientRect() : null;
        const gameScreenRect = this.screens.gameScreen ? this.screens.gameScreen.getBoundingClientRect() : null;
        const bodyStyles = window.getComputedStyle(document.body);
        const horizontalPadding = parseFloat(bodyStyles.paddingLeft) + parseFloat(bodyStyles.paddingRight);
        const verticalPadding = parseFloat(bodyStyles.paddingTop) + parseFloat(bodyStyles.paddingBottom);
        const layoutWidth = parentRect ? parentRect.width : (gameScreenRect ? gameScreenRect.width : window.innerWidth);
        const viewportWidth = window.innerWidth - horizontalPadding;
        const constrainedViewport = Math.max(160, viewportWidth);
        const availableWidth = Math.min(layoutWidth, constrainedViewport);

        let usedHeight = verticalPadding;
        const header = document.querySelector('header');
        if (header) {
            usedHeight += header.getBoundingClientRect().height;
        }
        const screenStyles = this.screens.gameScreen ? window.getComputedStyle(this.screens.gameScreen) : null;
        const paddingTop = screenStyles ? parseFloat(screenStyles.paddingTop) : 0;
        const paddingBottom = screenStyles ? parseFloat(screenStyles.paddingBottom) : 0;
        const gapY = screenStyles ? parseFloat(screenStyles.rowGap || screenStyles.gap || 0) : 0;

        usedHeight += paddingTop + paddingBottom;

        let gapSegments = 0;

        if (this.teamStats && this.teamStats.classList.contains('visible')) {
            usedHeight += this.teamStats.getBoundingClientRect().height;
            gapSegments += 1;
        }

        if (this.gameControls) {
            usedHeight += this.gameControls.getBoundingClientRect().height;
            gapSegments += 1;
        }

        if (this.touchControls && this.touchControls.classList.contains('visible')) {
            usedHeight += this.touchControls.getBoundingClientRect().height;
            gapSegments += 1;
        }

        usedHeight += gapSegments * gapY;

        let availableHeight = window.innerHeight - usedHeight;
        if (!Number.isFinite(availableHeight) || availableHeight <= 0) {
            availableHeight = window.innerHeight * 0.35;
        }

        const minimumBoardSlot = window.innerHeight * 0.56;
        availableHeight = Math.max(60, availableHeight, minimumBoardSlot);

        const widthScale = availableWidth / boardWidth;
        const heightScale = availableHeight / boardHeight;
        const scale = Math.min(1, widthScale, heightScale);

        const displayWidth = Math.max(1, Math.floor(boardWidth * scale));
        const displayHeight = Math.max(1, Math.floor(boardHeight * scale));

        boardWrapper.style.setProperty('--board-max-width', `${displayWidth}px`);
        canvas.style.width = `${displayWidth}px`;
        canvas.style.height = `${displayHeight}px`;
        canvas.style.maxWidth = `${boardWidth}px`;
        canvas.style.maxHeight = `${boardHeight}px`;
    }

    getActionForCode(player, code) {
        if (!player || !player.keys) return null;

        return Object.keys(player.keys).find(action => player.keys[action] === code) || null;
    }

    getInputState(playerId, action) {
        const states = gameState.inputStates.get(playerId);
        if (!states) return null;
        return states[action];
    }

    activateMovementAction(player, action) {
        const state = this.getInputState(player.id, action);
        if (!state) return false;

        let moved = false;
        if (!state.active) {
            state.active = true;
            state.heldTime = 0;
            state.hasFiredInitial = true;
            player.move(action === 'left' ? -1 : 1);
            moved = true;
        }

        return moved;
    }

    activateSoftDrop(player) {
        const state = this.getInputState(player.id, 'down');
        if (!state) return;

        if (!state.active) {
            state.active = true;
            state.heldTime = 0;
            state.hasFiredInitial = false;
        }
    }

    releaseContinuousAction(playerId, action) {
        const state = this.getInputState(playerId, action);
        if (!state) return;

        state.active = false;
        state.heldTime = 0;
        state.hasFiredInitial = false;
    }

    applyContinuousInputs(player, deltaTime) {
        const states = gameState.inputStates.get(player.id);
        if (!states) return;

        const moveRepeat = this.moveRepeatInterval;

        ['left', 'right'].forEach(direction => {
            const state = states[direction];
            if (!state) return;

            if (!state.active) {
                state.heldTime = 0;
                return;
            }

            state.heldTime += deltaTime;

            if (!state.hasFiredInitial) {
                player.move(direction === 'left' ? -1 : 1);
                state.hasFiredInitial = true;
                state.heldTime = 0;
                return;
            }

            if (state.heldTime >= moveRepeat) {
                player.move(direction === 'left' ? -1 : 1);
                state.heldTime = Math.max(0, state.heldTime - moveRepeat);
            }
        });

        const downState = states.down;
        if (!downState) return;

        if (!downState.active) {
            downState.heldTime = 0;
            downState.hasFiredInitial = false;
            return;
        }

        downState.heldTime += deltaTime;

        const dropInterval = downState.hasFiredInitial ? this.softDropRepeatInterval : this.softDropInitialDelay;
        if (!downState.hasFiredInitial || downState.heldTime >= dropInterval) {
            player.drop();
            downState.hasFiredInitial = true;
            downState.heldTime = 0;
        }
    }

    handleKeyPress(e) {
        const code = e.code;
        const isGameActive = this.screens.gameScreen.classList.contains('active') && gameState.players.length;

        if (code === 'Escape') {
            if (isGameActive && !gameState.isGameOver) {
                this.togglePause();
            }
            e.preventDefault();
            return;
        }

        if (!isGameActive || gameState.isPaused || gameState.isGameOver) {
            return;
        }

        if (e.repeat) {
            e.preventDefault();
            return;
        }

        let handled = false;
        const infoUpdates = new Set();
        let boardNeedsRedraw = false;

        gameState.players.forEach(player => {
            if (player.gameOver) return;

            const action = this.getActionForCode(player, code);
            if (!action) return;

            handled = true;

            switch (action) {
                case 'left':
                case 'right':
                    if (this.activateMovementAction(player, action)) {
                        boardNeedsRedraw = true;
                    }
                    break;
                case 'down':
                    this.activateSoftDrop(player);
                    break;
                case 'rotate':
                    player.rotate();
                    boardNeedsRedraw = true;
                    break;
                case 'drop':
                    player.hardDrop();
                    boardNeedsRedraw = true;
                    infoUpdates.add(player);
                    break;
                default:
                    break;
            }
        });

        if (!handled) {
            return;
        }

        e.preventDefault();

        infoUpdates.forEach(player => {
            this.updatePlayerInfo(player);
            this.drawNextPiece(player);
        });

        if (boardNeedsRedraw) {
            this.drawBoard();
        }

        this.updateTeamStatsIfNeeded();
    }

    handleKeyRelease(e) {
        const code = e.code;
        const isGameActive = this.screens.gameScreen.classList.contains('active') && gameState.players.length;

        if (!isGameActive) {
            return;
        }

        let handled = false;

        gameState.players.forEach(player => {
            if (player.gameOver) return;

            const action = this.getActionForCode(player, code);
            if (!action) return;

            if (action === 'left' || action === 'right' || action === 'down') {
                this.releaseContinuousAction(player.id, action);
                handled = true;
            }
        });

        if (handled) {
            e.preventDefault();
        }
    }

    togglePause() {
        if (gameState.isGameOver) return;

        gameState.isPaused = !gameState.isPaused;
        
        if (gameState.isPaused) {
            this.showModal('pause');
        } else {
            this.hideModal('pause');
            gameState.lastTime = performance.now();
        }
    }

    restart() {
        this.hideModal('pause');
        this.hideModal('gameOver');
        this.startGame(gameState.numPlayers);
    }

    quitToMenu() {
        this.hideModal('pause');
        this.hideModal('gameOver');
        gameState.isPaused = false;
        gameState.isGameOver = false;
        gameState.players = [];
        gameState.inputStates = new Map();
        resetSharedStats();
        this.showScreen('mainMenu');
        this.refreshTouchStatus();

        const teamStats = document.getElementById('team-stats');
        if (teamStats) {
            teamStats.classList.remove('visible');
            this.resetTeamStatsDisplay();
        }
    }

    showGameOver() {
        const scoresDiv = document.getElementById('final-scores');
        scoresDiv.innerHTML = '';

        const { score, level, lines } = gameState.sharedStats;

        const teamSummary = document.createElement('div');
        teamSummary.className = 'player-score team-total';
        teamSummary.innerHTML = `
            <strong>Team Score:</strong> ${score} points<br>
            <span>Level ${level} • ${lines} lines cleared</span>
        `;
        scoresDiv.appendChild(teamSummary);

        gameState.players.forEach(player => {
            const scoreDiv = document.createElement('div');
            scoreDiv.className = 'player-score';
            scoreDiv.style.background = player.color;
            scoreDiv.style.color = 'white';
            const status = player.gameOver ? 'Eliminated' : 'Survived';
            scoreDiv.innerHTML = `Player ${player.id + 1}: ${status}`;
            scoresDiv.appendChild(scoreDiv);
        });

        this.showModal('gameOver');
    }

    showCoopSetup() {
        this.showScreen('coopSetup');
        this.updateCoopPlayerConfig(1); // Default to 1 player
    }

    selectPlayerCount(btn) {
        // Update button states
        document.querySelectorAll('.player-count-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const count = parseInt(btn.dataset.count);
        this.updateCoopPlayerConfig(count);
    }

    updateCoopPlayerConfig(numPlayers) {
        const container = document.getElementById('coop-players-config');
        container.innerHTML = '';

        for (let i = 0; i < numPlayers; i++) {
            const card = document.createElement('div');
            card.className = 'coop-player-card';
            
            const color = gameState.settings.colors[i] || DEFAULT_COLORS[i];
            const keys = gameState.settings.keys[i] || DEFAULT_KEYS[i];
            
            card.innerHTML = `
                <h4>
                    <span class="player-color-badge" style="background: ${color};"></span>
                    Player ${i + 1}
                </h4>
                <div class="color-picker">
                    <label>Block Color:</label>
                    <input type="color" id="coop-color-${i}" value="${color}">
                </div>
                <div class="key-bindings">
                    <div class="key-binding">
                        <label>Left:</label>
                        <input type="text" id="coop-key-${i}-left" value="${formatKeyLabel(keys.left)}" 
                               data-key-code="${keys.left}" readonly>
                    </div>
                    <div class="key-binding">
                        <label>Right:</label>
                        <input type="text" id="coop-key-${i}-right" value="${formatKeyLabel(keys.right)}" 
                               data-key-code="${keys.right}" readonly>
                    </div>
                    <div class="key-binding">
                        <label>Down:</label>
                        <input type="text" id="coop-key-${i}-down" value="${formatKeyLabel(keys.down)}" 
                               data-key-code="${keys.down}" readonly>
                    </div>
                    <div class="key-binding">
                        <label>Rotate:</label>
                        <input type="text" id="coop-key-${i}-rotate" value="${formatKeyLabel(keys.rotate)}" 
                               data-key-code="${keys.rotate}" readonly>
                    </div>
                    <div class="key-binding">
                        <label>Drop:</label>
                        <input type="text" id="coop-key-${i}-drop" value="${formatKeyLabel(keys.drop)}" 
                               data-key-code="${keys.drop}" readonly>
                    </div>
                </div>
            `;
            
            container.appendChild(card);

            // Add event listener for key binding inputs
            const actions = ['left', 'right', 'down', 'rotate', 'drop'];
            actions.forEach(action => {
                const input = document.getElementById(`coop-key-${i}-${action}`);
                if (input) {
                    input.addEventListener('click', () => this.captureKey(input, i, action));
                }
            });

            // Add event listener for color picker
            const colorInput = document.getElementById(`coop-color-${i}`);
            if (colorInput) {
                colorInput.addEventListener('change', (e) => {
                    gameState.settings.colors[i] = e.target.value;
                    const badge = card.querySelector('.player-color-badge');
                    if (badge) badge.style.background = e.target.value;
                });
            }
        }
    }

    captureKey(input, playerIndex, action) {
        input.value = 'Press a key...';
        input.classList.add('capturing');
        
        const handler = (e) => {
            e.preventDefault();
            const code = e.code || e.key;
            input.value = formatKeyLabel(code);
            input.dataset.keyCode = code;
            gameState.settings.keys[playerIndex][action] = code;
            input.classList.remove('capturing');
            document.removeEventListener('keydown', handler);
        };
        
        document.addEventListener('keydown', handler);
    }

    startCoopGame() {
        // Get the selected player count
        const activeBtn = document.querySelector('.player-count-btn.active');
        const numPlayers = activeBtn ? parseInt(activeBtn.dataset.count) : 1;
        
        // Save the current co-op settings
        for (let i = 0; i < numPlayers; i++) {
            const colorInput = document.getElementById(`coop-color-${i}`);
            if (colorInput) {
                gameState.settings.colors[i] = colorInput.value;
            }
        }
        
        // Save to localStorage
        localStorage.setItem('blockies-settings', JSON.stringify(gameState.settings));
        
        // Start the game
        this.startGame(numPlayers);
    }

    showOnlineLobby() {
        this.showScreen('onlineLobby');
        this.updateConnectionStatus('connecting');
        
        // Setup network callbacks
        networkManager.on('connect', () => {
            this.updateConnectionStatus('connected');
        });

        networkManager.on('disconnect', () => {
            this.updateConnectionStatus('disconnected');
            this.showRoomsList([]);
        });

        networkManager.on('roomsList', (rooms) => {
            this.showRoomsList(rooms);
        });

        networkManager.on('roomCreated', (room) => {
            this.showRoomView(room);
        });

        networkManager.on('roomJoined', (room) => {
            this.showRoomView(room);
        });

        networkManager.on('roomUpdate', (room) => {
            this.updateRoomView(room);
        });

        networkManager.on('leftRoom', () => {
            this.hideRoomView();
        });

        networkManager.on('gameStart', (data) => {
            this.startOnlineGame(data);
        });

        networkManager.on('error', (message) => {
            alert('Error: ' + message);
        });

        // Connect to server
        networkManager.connect();
    }

    updateConnectionStatus(status) {
        const statusEl = document.querySelector('.connection-status');
        const indicator = statusEl.querySelector('.status-indicator');
        const text = statusEl.querySelector('.status-text');
        
        indicator.className = 'status-indicator ' + status;
        
        switch(status) {
            case 'connecting':
                text.textContent = 'Connecting to server...';
                break;
            case 'connected':
                text.textContent = 'Connected to server';
                break;
            case 'disconnected':
                text.textContent = 'Server not available';
                break;
        }
    }

    showRoomsList(rooms) {
        const container = document.getElementById('rooms-list');
        container.innerHTML = '';
        
        if (rooms.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 20px;">No rooms available. Create one to start!</p>';
        } else {
            rooms.forEach(room => {
                const roomDiv = document.createElement('div');
                roomDiv.className = 'room-item';
                roomDiv.innerHTML = `
                    <div class="room-info">
                        <h4>${room.name}</h4>
                        <p>${room.players}/${room.maxPlayers} players</p>
                    </div>
                    <button class="btn btn-primary btn-small">Join</button>
                `;
                roomDiv.querySelector('.btn').addEventListener('click', () => this.joinRoom(room.id));
                container.appendChild(roomDiv);
            });
        }
    }

    createRoom() {
        const roomName = prompt('Enter room name:', 'My Room');
        if (roomName) {
            networkManager.createRoom(roomName);
        }
    }

    joinRoom(roomId) {
        networkManager.joinRoom(roomId);
    }

    leaveRoom() {
        networkManager.leaveRoom();
    }

    toggleReady() {
        networkManager.toggleReady();
        const btn = document.getElementById('ready-btn');
        if (btn) {
            if (btn.textContent.includes('Ready')) {
                btn.textContent = '⏳ Waiting...';
                btn.classList.remove('btn-primary');
                btn.classList.add('btn-secondary');
            } else {
                btn.textContent = '✓ Ready';
                btn.classList.remove('btn-secondary');
                btn.classList.add('btn-primary');
            }
        }
    }

    showRoomView(room) {
        const roomView = document.getElementById('room-view');
        const roomsSection = document.querySelector('.rooms-section');
        
        if (roomView && roomsSection) {
            roomsSection.style.display = 'none';
            roomView.style.display = 'block';
            this.updateRoomView(room);
        }
    }

    hideRoomView() {
        const roomView = document.getElementById('room-view');
        const roomsSection = document.querySelector('.rooms-section');
        
        if (roomView && roomsSection) {
            roomView.style.display = 'none';
            roomsSection.style.display = 'block';
        }
    }

    updateRoomView(room) {
        const roomNameEl = document.getElementById('room-name');
        const playersListEl = document.getElementById('room-players-list');
        const colorOptionsEl = document.getElementById('color-options');
        const statusEl = document.getElementById('room-status');
        
        if (roomNameEl) {
            roomNameEl.textContent = room.name;
        }

        // Update players list
        if (playersListEl) {
            playersListEl.innerHTML = '';
            room.players.forEach(player => {
                const playerDiv = document.createElement('div');
                playerDiv.className = 'room-player-item';
                playerDiv.innerHTML = `
                    <div class="room-player-color" style="background: ${player.color};"></div>
                    <div class="room-player-name">${player.name}</div>
                    <div class="room-player-status">${player.ready ? '✓ Ready' : 'Not Ready'}</div>
                `;
                playersListEl.appendChild(playerDiv);
            });
        }

        // Update color options
        if (colorOptionsEl) {
            colorOptionsEl.innerHTML = '';
            const COLORS = ['#FF1493', '#00D9FF', '#FFDB58', '#39FF14'];
            const myPlayer = room.players.find(p => p.id === networkManager.socket.id);
            
            COLORS.forEach(color => {
                const colorDiv = document.createElement('div');
                colorDiv.className = 'color-option';
                colorDiv.style.background = color;
                
                const isUsed = room.players.some(p => p.color === color);
                const isMyColor = myPlayer && myPlayer.color === color;
                
                if (isMyColor) {
                    colorDiv.classList.add('selected');
                } else if (isUsed) {
                    colorDiv.classList.add('disabled');
                } else {
                    colorDiv.addEventListener('click', () => {
                        networkManager.changeColor(color);
                    });
                }
                
                colorOptionsEl.appendChild(colorDiv);
            });
        }

        // Update status
        if (statusEl) {
            const readyCount = room.players.filter(p => p.ready).length;
            if (readyCount === room.players.length && room.players.length > 0) {
                statusEl.textContent = 'Starting game...';
                statusEl.style.background = 'rgba(46, 213, 115, 0.15)';
                statusEl.style.borderColor = 'rgba(46, 213, 115, 0.3)';
            } else {
                statusEl.textContent = `${readyCount}/${room.players.length} players ready`;
                statusEl.style.background = 'rgba(255, 219, 88, 0.15)';
                statusEl.style.borderColor = 'rgba(255, 219, 88, 0.3)';
            }
        }
    }

    startOnlineGame(data) {
        // Map network players to game players
        const numPlayers = data.players.length;
        
        // Store network player info for synchronization
        this.networkPlayers = {};
        this.localPlayerIndex = -1;
        
        // Update game state with player colors from network and map IDs
        data.players.forEach((netPlayer, index) => {
            gameState.settings.colors[index] = netPlayer.color;
            this.networkPlayers[netPlayer.id] = index;
            
            // Identify which player is the local player
            if (networkManager.socket && netPlayer.id === networkManager.socket.id) {
                this.localPlayerIndex = index;
            }
        });
        
        // Start the game with proper player count
        this.startGame(numPlayers);
        
        // Set up online synchronization
        this.setupOnlineSync();
        
        console.log('Online game started with players:', data.players);
        console.log('Local player index:', this.localPlayerIndex);
    }
    
    setupOnlineSync() {
        if (!networkManager.socket) return;
        
        // Store original player update methods to intercept actions
        const originalHandleKeyPress = this.handleKeyPress.bind(this);
        const originalHandleKeyRelease = this.handleKeyRelease.bind(this);
        
        // Override to only allow local player control in online mode
        this.handleKeyPress = (e) => {
            if (this.localPlayerIndex >= 0) {
                // Only process input for local player
                const player = gameState.players[this.localPlayerIndex];
                if (player && !player.gameOver) {
                    originalHandleKeyPress(e);
                }
            }
        };
        
        this.handleKeyRelease = (e) => {
            if (this.localPlayerIndex >= 0) {
                const player = gameState.players[this.localPlayerIndex];
                if (player && !player.gameOver) {
                    originalHandleKeyRelease(e);
                }
            }
        };
        
        // Listen for remote player inputs
        networkManager.on('playerInput', (data) => {
            const playerIndex = this.networkPlayers[data.playerId];
            if (playerIndex !== undefined && playerIndex !== this.localPlayerIndex) {
                const player = gameState.players[playerIndex];
                if (player && !player.gameOver) {
                    // Apply the action from remote player
                    switch (data.action) {
                        case 'move':
                            player.move(data.direction);
                            break;
                        case 'rotate':
                            player.rotate();
                            break;
                        case 'drop':
                            player.drop();
                            break;
                        case 'hardDrop':
                            player.hardDrop();
                            break;
                    }
                }
            }
        });
    }

    showSettings() {
        const container = document.getElementById('settings-container');
        container.innerHTML = '';

        // Only show settings for the current number of players, or all 4 if no game is active
        const numPlayersToShow = gameState.numPlayers > 0 ? gameState.numPlayers : 4;

        for (let i = 0; i < numPlayersToShow; i++) {
            const playerDiv = document.createElement('div');
            playerDiv.className = 'player-settings';
            
            const title = document.createElement('h3');
            title.textContent = `Player ${i + 1}`;
            playerDiv.appendChild(title);

            // Color picker
            const colorDiv = document.createElement('div');
            colorDiv.className = 'color-picker';
            const colorValue = gameState.settings.colors[i] || DEFAULT_COLORS[i];
            colorDiv.innerHTML = `
                <label>Block Color:</label>
                <input type="color" id="color-${i}" value="${colorValue}">
            `;
            playerDiv.appendChild(colorDiv);

            // Key bindings - in a more compact grid
            const keysDiv = document.createElement('div');
            keysDiv.className = 'key-bindings';
            
            const actions = ['left', 'right', 'down', 'rotate', 'drop'];
            const labels = ['Left', 'Right', 'Down', 'Rotate', 'Drop'];
            
            actions.forEach((action, idx) => {
                const bindingDiv = document.createElement('div');
                bindingDiv.className = 'key-binding';
                const currentCode = normalizeKeyCode(gameState.settings.keys[i][action] || DEFAULT_KEYS[i][action]);
                bindingDiv.innerHTML = `
                    <label>${labels[idx]}:</label>
                    <input type="text" id="key-${i}-${action}"
                           value="${formatKeyLabel(currentCode)}"
                           readonly
                           data-player="${i}"
                           data-action="${action}"
                           data-key-code="${currentCode}">
                `;
                keysDiv.appendChild(bindingDiv);
                gameState.settings.keys[i][action] = currentCode;
            });

            playerDiv.appendChild(keysDiv);
            
            // Gamepad assignment
            const gamepadDiv = document.createElement('div');
            gamepadDiv.className = 'gamepad-picker';
            gamepadDiv.innerHTML = `
                <label>Gamepad:</label>
                <select id="gamepad-${i}" class="gamepad-select">
                    <option value="">Keyboard</option>
                </select>
            `;
            playerDiv.appendChild(gamepadDiv);
            
            container.appendChild(playerDiv);
        }
        
        // Populate gamepad dropdowns
        scanGamepads();
        const gamepads = gameState.gamepads.connected;
        
        for (let i = 0; i < numPlayersToShow; i++) {
            const select = document.getElementById(`gamepad-${i}`);
            if (!select) continue;
            
            // Add gamepad options
            gamepads.forEach(gp => {
                const option = document.createElement('option');
                option.value = gp.index;
                option.textContent = `Gamepad ${gp.index + 1}`;
                
                // Check if this gamepad is already assigned to this player
                if (gameState.gamepads.assignments[gp.index] === i) {
                    option.selected = true;
                }
                
                select.appendChild(option);
            });
        }

        // Add event listeners for key binding inputs
        document.querySelectorAll('.key-binding input').forEach(input => {
            input.addEventListener('click', (e) => this.captureKey(e.target));
        });

        this.showScreen('settingsScreen');
    }

    captureKey(input) {
        input.value = 'Press a key...';

        const handler = (e) => {
            e.preventDefault();
            const code = normalizeKeyCode(e.code || e.key);
            input.dataset.keyCode = code;
            input.value = formatKeyLabel(code);
            document.removeEventListener('keydown', handler);
        };

        document.addEventListener('keydown', handler);
    }

    saveSettings() {
        const numPlayersToSave = gameState.numPlayers > 0 ? gameState.numPlayers : 4;

        // Save colors
        for (let i = 0; i < numPlayersToSave; i++) {
            const colorInput = document.getElementById(`color-${i}`);
            if (colorInput) {
                gameState.settings.colors[i] = colorInput.value;
            }
        }

        // Save key bindings
        for (let i = 0; i < numPlayersToSave; i++) {
            const actions = ['left', 'right', 'down', 'rotate', 'drop'];
            actions.forEach(action => {
                const keyInput = document.getElementById(`key-${i}-${action}`);
                if (!keyInput) return;
                const storedCode = keyInput.dataset.keyCode || '';
                const finalCode = normalizeKeyCode(storedCode || keyInput.value);
                if (finalCode) {
                    gameState.settings.keys[i][action] = finalCode;
                }
            });
        }
        
        // Save gamepad assignments
        gameState.gamepads.assignments = {};
        for (let i = 0; i < numPlayersToSave; i++) {
            const select = document.getElementById(`gamepad-${i}`);
            if (select && select.value !== '') {
                const gamepadIndex = parseInt(select.value);
                gameState.gamepads.assignments[gamepadIndex] = i;
            }
        }

        // Save to localStorage
        localStorage.setItem('blockies-settings', JSON.stringify(gameState.settings));
        localStorage.setItem('blockies-gamepad-assignments', JSON.stringify(gameState.gamepads.assignments));

        // Return to previous screen instead of always going to main menu
        this.showScreen(this.previousScreen || 'mainMenu');
    }

    hideSettings() {
        // Return to previous screen instead of always going to main menu
        this.showScreen(this.previousScreen || 'mainMenu');
    }
}

// Initialize the game
function init() {
    // Load settings from localStorage
    const savedSettings = localStorage.getItem('blockies-settings');
    if (savedSettings) {
        try {
            const parsed = JSON.parse(savedSettings);
            if (parsed && typeof parsed === 'object') {
                if (Array.isArray(parsed.colors) && parsed.colors.length) {
                    const colors = parsed.colors.slice(0, DEFAULT_COLORS.length);
                    while (colors.length < DEFAULT_COLORS.length) {
                        colors.push(DEFAULT_COLORS[colors.length]);
                    }
                    gameState.settings.colors = colors;
                }

                if (Array.isArray(parsed.keys)) {
                    const actions = ['left', 'right', 'down', 'rotate', 'drop'];
                    const keysArray = parsed.keys.slice(0, DEFAULT_KEYS.length);
                    gameState.settings.keys = keysArray.map((keySet = {}, index) => {
                        const defaults = DEFAULT_KEYS[index] || DEFAULT_KEYS[0];
                        const normalizedSet = {};
                        actions.forEach(action => {
                            const candidate = keySet[action] || defaults[action];
                            normalizedSet[action] = normalizeKeyCode(candidate);
                        });
                        return normalizedSet;
                    });
                }
            }
        } catch (e) {
            console.error('Failed to load settings:', e);
        }
    }

    if (!Array.isArray(gameState.settings.keys)) {
        gameState.settings.keys = JSON.parse(JSON.stringify(DEFAULT_KEYS));
    } else {
        const actions = ['left', 'right', 'down', 'rotate', 'drop'];
        gameState.settings.keys = gameState.settings.keys.slice(0, DEFAULT_KEYS.length);
        while (gameState.settings.keys.length < DEFAULT_KEYS.length) {
            const index = gameState.settings.keys.length;
            const defaults = DEFAULT_KEYS[index] || DEFAULT_KEYS[0];
            const filled = {};
            actions.forEach(action => {
                filled[action] = defaults[action];
            });
            gameState.settings.keys.push(filled);
        }
    }
    
    // Load gamepad assignments
    const savedGamepadAssignments = localStorage.getItem('blockies-gamepad-assignments');
    if (savedGamepadAssignments) {
        try {
            gameState.gamepads.assignments = JSON.parse(savedGamepadAssignments);
        } catch (e) {
            console.error('Failed to load gamepad assignments:', e);
        }
    }

    const ui = new UIManager();
}

// Start the game when the page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
