// Game Configuration
const BLOCK_SIZE = 25;
const BOARD_WIDTH = 10;
const BOARD_HEIGHT = 20;
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

// Default key bindings for players
const DEFAULT_KEYS = [
    { left: 'ArrowLeft', right: 'ArrowRight', down: 'ArrowDown', rotate: 'ArrowUp', drop: ' ' },
    { left: 'a', right: 'd', down: 's', rotate: 'w', drop: 'q' },
    { left: 'j', right: 'l', down: 'k', rotate: 'i', drop: 'u' },
    { left: 'Numpad4', right: 'Numpad6', down: 'Numpad5', rotate: 'Numpad8', drop: 'Numpad0' }
];

// Game State
let gameState = {
    players: [],
    numPlayers: 1,
    isPaused: false,
    isGameOver: false,
    settings: {
        colors: [...DEFAULT_COLORS],
        keys: JSON.parse(JSON.stringify(DEFAULT_KEYS))
    }
};

// Player Class
class Player {
    constructor(id, color, keys) {
        this.id = id;
        this.color = color;
        this.keys = keys;
        this.board = Array(BOARD_HEIGHT).fill().map(() => Array(BOARD_WIDTH).fill(0));
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
        this.position = {
            x: Math.floor(BOARD_WIDTH / 2) - Math.floor(this.currentPiece[0].length / 2),
            y: 0
        };

        if (this.collides()) {
            this.gameOver = true;
            gameState.isGameOver = true;
        }
    }

    collides(piece = this.currentPiece, pos = this.position) {
        for (let y = 0; y < piece.length; y++) {
            for (let x = 0; x < piece[y].length; x++) {
                if (piece[y][x]) {
                    const boardX = pos.x + x;
                    const boardY = pos.y + y;
                    
                    if (boardX < 0 || boardX >= BOARD_WIDTH || boardY >= BOARD_HEIGHT) {
                        return true;
                    }
                    
                    if (boardY >= 0 && this.board[boardY][boardX]) {
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
        while (!this.collides()) {
            this.position.y++;
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
                        this.board[boardY][boardX] = 1;
                    }
                }
            }
        }
    }

    clearLines() {
        let linesCleared = 0;
        
        for (let y = BOARD_HEIGHT - 1; y >= 0; y--) {
            if (this.board[y].every(cell => cell === 1)) {
                this.board.splice(y, 1);
                this.board.unshift(Array(BOARD_WIDTH).fill(0));
                linesCleared++;
                y++; // Check the same row again
            }
        }

        if (linesCleared > 0) {
            this.lines += linesCleared;
            this.score += [0, 100, 300, 500, 800][linesCleared] * this.level;
            this.level = Math.floor(this.lines / 10) + 1;
            this.dropInterval = Math.max(100, 1000 - (this.level - 1) * 100);
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

        this.setupEventListeners();
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
    }

    showScreen(screenName) {
        Object.values(this.screens).forEach(screen => screen.classList.remove('active'));
        this.screens[screenName].classList.add('active');
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

        const container = document.getElementById('game-container');
        container.innerHTML = '';

        for (let i = 0; i < numPlayers; i++) {
            const player = new Player(
                i,
                gameState.settings.colors[i],
                gameState.settings.keys[i]
            );
            player.init();
            gameState.players.push(player);

            this.createPlayerBoard(player, container);
        }

        this.showScreen('gameScreen');
        requestAnimationFrame((time) => this.gameLoop(time));
    }

    createPlayerBoard(player, container) {
        const boardDiv = document.createElement('div');
        boardDiv.className = 'player-board';
        boardDiv.id = `player-${player.id}`;

        const header = document.createElement('div');
        header.className = 'player-header';
        header.style.background = player.color;
        header.style.color = 'white';
        header.textContent = `Player ${player.id + 1}`;

        const info = document.createElement('div');
        info.className = 'player-info';
        info.innerHTML = `
            <div class="score">Score: <span id="score-${player.id}">0</span></div>
            <div class="level">Level: <span id="level-${player.id}">1</span></div>
            <div class="lines">Lines: <span id="lines-${player.id}">0</span></div>
        `;

        const canvas = document.createElement('canvas');
        canvas.id = `canvas-${player.id}`;
        canvas.width = BOARD_WIDTH * BLOCK_SIZE;
        canvas.height = BOARD_HEIGHT * BLOCK_SIZE;

        const nextDiv = document.createElement('div');
        nextDiv.className = 'next-piece';
        nextDiv.innerHTML = '<div>Next:</div>';
        const nextCanvas = document.createElement('canvas');
        nextCanvas.id = `next-${player.id}`;
        nextCanvas.width = PREVIEW_SIZE * BLOCK_SIZE;
        nextCanvas.height = PREVIEW_SIZE * BLOCK_SIZE;
        nextDiv.appendChild(nextCanvas);

        boardDiv.appendChild(header);
        boardDiv.appendChild(info);
        boardDiv.appendChild(canvas);
        boardDiv.appendChild(nextDiv);
        container.appendChild(boardDiv);
    }

    gameLoop(time) {
        if (gameState.isGameOver) {
            this.showGameOver();
            return;
        }

        if (!gameState.isPaused) {
            const deltaTime = time - (gameState.lastTime || time);
            gameState.lastTime = time;

            gameState.players.forEach(player => {
                if (!player.gameOver) {
                    player.update(deltaTime);
                    this.drawPlayer(player);
                    this.updatePlayerInfo(player);
                }
            });
        }

        requestAnimationFrame((time) => this.gameLoop(time));
    }

    drawPlayer(player) {
        const canvas = document.getElementById(`canvas-${player.id}`);
        const ctx = canvas.getContext('2d');

        // Clear canvas
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw board
        for (let y = 0; y < BOARD_HEIGHT; y++) {
            for (let x = 0; x < BOARD_WIDTH; x++) {
                if (player.board[y][x]) {
                    ctx.fillStyle = player.color;
                    ctx.fillRect(x * BLOCK_SIZE, y * BLOCK_SIZE, BLOCK_SIZE - 1, BLOCK_SIZE - 1);
                    
                    // Add cute border effect
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
                    ctx.lineWidth = 2;
                    ctx.strokeRect(x * BLOCK_SIZE + 1, y * BLOCK_SIZE + 1, BLOCK_SIZE - 3, BLOCK_SIZE - 3);
                }
            }
        }

        // Draw current piece
        if (player.currentPiece) {
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
        }

        // Draw next piece
        const nextCanvas = document.getElementById(`next-${player.id}`);
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
        document.getElementById(`score-${player.id}`).textContent = player.score;
        document.getElementById(`level-${player.id}`).textContent = player.level;
        document.getElementById(`lines-${player.id}`).textContent = player.lines;
    }

    handleKeyPress(e) {
        if (gameState.isPaused || gameState.isGameOver) {
            if (e.key === 'Escape') {
                this.togglePause();
            }
            return;
        }

        gameState.players.forEach(player => {
            if (player.gameOver) return;

            const keys = player.keys;
            
            if (e.key === keys.left) {
                player.move(-1);
                e.preventDefault();
            } else if (e.key === keys.right) {
                player.move(1);
                e.preventDefault();
            } else if (e.key === keys.down) {
                player.drop();
                e.preventDefault();
            } else if (e.key === keys.rotate) {
                player.rotate();
                e.preventDefault();
            } else if (e.key === keys.drop) {
                player.hardDrop();
                e.preventDefault();
            }
        });

        if (e.key === 'Escape') {
            this.togglePause();
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
        gameState.isGameOver = true;
        this.showScreen('mainMenu');
    }

    showGameOver() {
        const scoresDiv = document.getElementById('final-scores');
        scoresDiv.innerHTML = '';

        const sortedPlayers = [...gameState.players].sort((a, b) => b.score - a.score);

        sortedPlayers.forEach((player, index) => {
            const scoreDiv = document.createElement('div');
            scoreDiv.className = 'player-score';
            scoreDiv.style.background = player.color;
            scoreDiv.style.color = 'white';
            scoreDiv.innerHTML = `
                ${index === 0 ? '👑 ' : ''}Player ${player.id + 1}: ${player.score} points
            `;
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
            colorDiv.innerHTML = `
                <label>Block Color:</label>
                <input type="color" id="color-${i}" value="${gameState.settings.colors[i]}">
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
                bindingDiv.innerHTML = `
                    <label>${labels[idx]}:</label>
                    <input type="text" id="key-${i}-${action}" 
                           value="${gameState.settings.keys[i][action]}" 
                           readonly
                           data-player="${i}" 
                           data-action="${action}">
                `;
                keysDiv.appendChild(bindingDiv);
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
            input.value = e.key;
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
                if (keyInput.value && keyInput.value !== 'Press a key...') {
                    gameState.settings.keys[i][action] = keyInput.value;
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
            gameState.settings = JSON.parse(savedSettings);
        } catch (e) {
            console.error('Failed to load settings:', e);
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
