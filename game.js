// Game Configuration
const BLOCK_SIZE = 25;
const BASE_BOARD_WIDTH = 10;
const BOARD_HEIGHT = 20;
const ADDITIONAL_COLUMNS_PER_PLAYER = 4;
const PREVIEW_SIZE = 4;

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

// Default colors for players
const DEFAULT_COLORS = ['#FF6B6B', '#4ECDC4', '#FFD93D', '#95E1D3'];

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
    level: 1
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
    }
};

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

                if (!this.collides(this.currentPiece, { x: candidate, y: 0 })) {
                    spawnPosition = { x: candidate, y: 0 };
                    break;
                }
            }

            if (spawnPosition) break;
        }

        this.position = spawnPosition || { x: preferredX, y: 0 };

        if (!spawnPosition && this.collides()) {
            this.gameOver = true;
            checkAllPlayersGameOver();
        }

        this.dropCounter = 0;
    }

    collides(piece = this.currentPiece, pos = this.position) {
        for (let y = 0; y < piece.length; y++) {
            for (let x = 0; x < piece[y].length; x++) {
                if (piece[y][x]) {
                    const boardX = pos.x + x;
                    const boardY = pos.y + y;

                    const boardWidth = getBoardWidth();
                    if (boardX < 0 || boardX >= boardWidth || boardY >= BOARD_HEIGHT) {
                        return true;
                    }

                    if (boardY >= 0 && (gameState.board[boardY][boardX] ||
                        isCellOccupiedByOtherPiece(boardX, boardY, this.id))) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    move(dir) {
        this.position.x += dir;
        if (this.collides()) {
            this.position.x -= dir;
        }
    }

    rotate() {
        const rotated = this.currentPiece[0].map((_, i) =>
            this.currentPiece.map(row => row[i]).reverse()
        );

        if (!this.collides(rotated)) {
            this.currentPiece = rotated;
        }
    }

    drop() {
        this.position.y++;
        if (this.collides()) {
            this.position.y--;
            this.merge();
            this.clearLines();
            this.spawnPiece();
        }
        this.dropCounter = 0;
    }

    hardDrop() {
        let maxDrops = BOARD_HEIGHT; // Safety limit
        while (!this.collides() && maxDrops > 0) {
            this.position.y++;
            maxDrops--;
        }
        this.position.y--;
        this.merge();
        this.clearLines();
        this.spawnPiece();
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

        if (linesCleared > 0) {
            const lineScores = [0, 100, 300, 500, 800];
            const baseScore = lineScores[linesCleared] || lineScores[lineScores.length - 1];
            const gained = baseScore * gameState.sharedStats.level;

            gameState.sharedStats.lines += linesCleared;
            gameState.sharedStats.score += gained;
            gameState.sharedStats.level = Math.floor(gameState.sharedStats.lines / 10) + 1;

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
    }
}

// UI Manager
class UIManager {
    constructor() {
        this.screens = {
            mainMenu: document.getElementById('main-menu'),
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

        this.moveRepeatInterval = 90;
        this.softDropInitialDelay = 0;
        this.softDropRepeatInterval = 55;

        this.setupEventListeners();
        this.initTouchControls();
    }

    setupEventListeners() {
        // Mode selection
        document.getElementById('mode-1p').addEventListener('click', () => this.startGame(1));
        document.getElementById('mode-2p').addEventListener('click', () => this.startGame(2));
        document.getElementById('mode-3p').addEventListener('click', () => this.startGame(3));
        document.getElementById('mode-4p').addEventListener('click', () => this.startGame(4));

        // Settings
        document.getElementById('settings-btn').addEventListener('click', () => this.showSettings());
        document.getElementById('save-settings-btn').addEventListener('click', () => this.saveSettings());
        document.getElementById('cancel-settings-btn').addEventListener('click', () => this.hideSettings());

        // Game controls
        document.getElementById('pause-btn').addEventListener('click', () => this.togglePause());
        document.getElementById('quit-btn').addEventListener('click', () => this.quitToMenu());

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
        Object.values(this.screens).forEach(screen => screen.classList.remove('active'));
        this.screens[screenName].classList.add('active');

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

        const boardWrapper = document.createElement('div');
        boardWrapper.id = 'shared-board';

        const canvas = document.createElement('canvas');
        canvas.id = 'game-canvas';
        canvas.width = gameState.boardWidth * BLOCK_SIZE;
        canvas.height = BOARD_HEIGHT * BLOCK_SIZE;
        boardWrapper.appendChild(canvas);

        const infoWrapper = document.createElement('div');
        infoWrapper.id = 'players-info';

        container.appendChild(boardWrapper);
        container.appendChild(infoWrapper);

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

            this.createPlayerInfo(player, infoWrapper);
            this.updatePlayerInfo(player);
            this.drawNextPiece(player);
        }


        this.drawBoard();

        this.showScreen('gameScreen');
        this.refreshTouchStatus();
        requestAnimationFrame((time) => this.gameLoop(time));
    }

    createPlayerInfo(player, container) {
        const playerCard = document.createElement('div');
        playerCard.className = 'player-info-card';
        playerCard.id = `player-${player.id}`;

        const header = document.createElement('div');
        header.className = 'player-header';
        header.style.background = player.color;
        header.style.color = 'white';
        header.textContent = `Player ${player.id + 1}`;

        const stats = document.createElement('div');
        stats.className = 'player-info';
        stats.innerHTML = `
            <div class="score">Team Score: <span id="score-${player.id}">0</span></div>
            <div class="level">Team Level: <span id="level-${player.id}">1</span></div>
            <div class="lines">Team Lines: <span id="lines-${player.id}">0</span></div>
        `;

        const nextDiv = document.createElement('div');
        nextDiv.className = 'next-piece';
        nextDiv.innerHTML = '<div>Next:</div>';
        const nextCanvas = document.createElement('canvas');
        nextCanvas.id = `next-${player.id}`;
        nextCanvas.width = PREVIEW_SIZE * BLOCK_SIZE;
        nextCanvas.height = PREVIEW_SIZE * BLOCK_SIZE;
        nextDiv.appendChild(nextCanvas);

        playerCard.appendChild(header);
        playerCard.appendChild(stats);
        playerCard.appendChild(nextDiv);
        container.appendChild(playerCard);
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
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        for (let y = 0; y < BOARD_HEIGHT; y++) {
            for (let x = 0; x < boardWidth; x++) {
                const occupant = gameState.board[y][x];
                if (occupant) {
                    const player = gameState.players[occupant - 1];
                    const color = player ? player.color : '#333';
                    ctx.fillStyle = color;
                    ctx.fillRect(x * BLOCK_SIZE, y * BLOCK_SIZE, BLOCK_SIZE - 1, BLOCK_SIZE - 1);

                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
                    ctx.lineWidth = 2;
                    ctx.strokeRect(x * BLOCK_SIZE + 1, y * BLOCK_SIZE + 1, BLOCK_SIZE - 3, BLOCK_SIZE - 3);
                }
            }
        }

        gameState.players.forEach(player => {
            if (!player.currentPiece || player.gameOver) return;

            ctx.fillStyle = player.color;
            for (let y = 0; y < player.currentPiece.length; y++) {
                for (let x = 0; x < player.currentPiece[y].length; x++) {
                    if (player.currentPiece[y][x]) {
                        const drawX = (player.position.x + x) * BLOCK_SIZE;
                        const drawY = (player.position.y + y) * BLOCK_SIZE;
                        ctx.fillRect(drawX, drawY, BLOCK_SIZE - 1, BLOCK_SIZE - 1);

                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
                        ctx.lineWidth = 2;
                        ctx.strokeRect(drawX + 1, drawY + 1, BLOCK_SIZE - 3, BLOCK_SIZE - 3);
                    }
                }
            }
        });
    }

    drawNextPiece(player) {
        const nextCanvas = document.getElementById(`next-${player.id}`);
        if (!nextCanvas) return;

        const nextCtx = nextCanvas.getContext('2d');
        nextCtx.fillStyle = '#fff';
        nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);

        if (player.nextPiece) {
            nextCtx.fillStyle = player.color;
            const offsetX = Math.floor((PREVIEW_SIZE - player.nextPiece[0].length) / 2);
            const offsetY = Math.floor((PREVIEW_SIZE - player.nextPiece.length) / 2);

            for (let y = 0; y < player.nextPiece.length; y++) {
                for (let x = 0; x < player.nextPiece[y].length; x++) {
                    if (player.nextPiece[y][x]) {
                        const drawX = (offsetX + x) * BLOCK_SIZE;
                        const drawY = (offsetY + y) * BLOCK_SIZE;
                        nextCtx.fillRect(drawX, drawY, BLOCK_SIZE - 1, BLOCK_SIZE - 1);

                        nextCtx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
                        nextCtx.lineWidth = 2;
                        nextCtx.strokeRect(drawX + 1, drawY + 1, BLOCK_SIZE - 3, BLOCK_SIZE - 3);
                    }
                }
            }
        }
    }

    updatePlayerInfo(player) {
        const scoreEl = document.getElementById(`score-${player.id}`);
        const levelEl = document.getElementById(`level-${player.id}`);
        const linesEl = document.getElementById(`lines-${player.id}`);

        if (!scoreEl || !levelEl || !linesEl) {
            return;
        }

        scoreEl.textContent = player.score;
        levelEl.textContent = player.level;
        linesEl.textContent = player.lines;
    }

    updateTeamStats() {
        const { score, level, lines } = gameState.sharedStats;
        const scoreEl = document.getElementById('team-score');
        const levelEl = document.getElementById('team-level');
        const linesEl = document.getElementById('team-lines');

        if (scoreEl) scoreEl.textContent = score;
        if (levelEl) levelEl.textContent = level;
        if (linesEl) linesEl.textContent = lines;
    }

    resetTeamStatsDisplay() {
        const scoreEl = document.getElementById('team-score');
        const levelEl = document.getElementById('team-level');
        const linesEl = document.getElementById('team-lines');

        if (scoreEl) scoreEl.textContent = '0';
        if (levelEl) levelEl.textContent = '1';
        if (linesEl) linesEl.textContent = '0';
    }

    updateTeamStatsIfNeeded() {
        if (gameState.sharedStatsDirty) {
            this.updateTeamStats();
            gameState.sharedStatsDirty = false;
        }
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

    showSettings() {
        const container = document.getElementById('settings-container');
        container.innerHTML = '';

        for (let i = 0; i < 4; i++) {
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

            // Key bindings
            const keysDiv = document.createElement('div');
            keysDiv.className = 'key-bindings';
            
            const actions = ['left', 'right', 'down', 'rotate', 'drop'];
            const labels = ['Move Left', 'Move Right', 'Move Down', 'Rotate', 'Hard Drop'];
            
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
            container.appendChild(playerDiv);
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
        // Save colors
        for (let i = 0; i < 4; i++) {
            const colorInput = document.getElementById(`color-${i}`);
            gameState.settings.colors[i] = colorInput.value;
        }

        // Save key bindings
        for (let i = 0; i < 4; i++) {
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

        // Save to localStorage
        localStorage.setItem('blockies-settings', JSON.stringify(gameState.settings));

        this.showScreen('mainMenu');
    }

    hideSettings() {
        this.showScreen('mainMenu');
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

    const ui = new UIManager();
}

// Start the game when the page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
