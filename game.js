// ---------- Global Networking ----------
let isHost = false;
let roomCode = null;          // host's peer ID (used as join code)
let hostConnection = null;    // client's active connection to host
let clientPeer = null;        // client's own Peer instance
let hostPeer = null;          // host's Peer instance
let connections = [];         // host side: array of active DataConnections

// Lightweight WebAudio synth for in-game sounds
class Synth {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.unlocked = false;
    }

    init() {
        if (this.ctx) return;
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AC();
            this.master = this.ctx.createGain();
            this.master.gain.value = 0.18;
            this.master.connect(this.ctx.destination);
        } catch (e) {
            console.warn('AudioContext unavailable', e);
            this.ctx = null;
        }
    }

    unlock() {
        this.init();
        if (!this.ctx) return;
        if (this.ctx.state === 'suspended') {
            this.ctx.resume().then(() => { this.unlocked = true; }).catch(()=>{});
        } else {
            this.unlocked = true;
        }
    }

    playOsc(type, freq, duration = 0.12, gain = 0.12) {
        if (!this.ctx || !this.unlocked) return;
        const now = this.ctx.currentTime;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, now);
        g.gain.setValueAtTime(gain, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + duration);
        o.connect(g); g.connect(this.master);
        o.start(now);
        o.stop(now + duration + 0.02);
    }

    playShot() { this.playOsc('sawtooth', 880, 0.08, 0.08); }
    playHit() { this.playOsc('square', 420, 0.10, 0.10); }
    playExplosion() { this.playOsc('sawtooth', 160, 0.28, 0.22); this.playOsc('sine', 260, 0.18, 0.10); }
    playBigSpawn() { this.playOsc('triangle', 220, 0.36, 0.18); }
    playDeath() { this.playOsc('sawtooth', 120, 0.6, 0.24); }
    playTick() { this.playOsc('square', 1200, 0.06, 0.06); }
    playGo() { this.playOsc('sawtooth', 1400, 0.18, 0.12); }
}

window.synth = window.synth || new Synth();
// DOM Elements
const sectorButtons = Array.from(document.querySelectorAll('.sector-btn'));
const statusText = document.getElementById('lobby-status');

// ---------- Lobby Events ----------
sectorButtons.forEach((button) => {
    button.addEventListener('click', () => {
        const sector = button.getAttribute('data-sector');
        if (!sector) return;
        selectSector(sector);
    });
});

function selectSector(sector) {
    const targetPeerId = `neon-sector-${sector}`;

    sectorButtons.forEach((button) => {
        button.disabled = true;
    });
    statusText.innerText = `Preparing sector ${sector}...`;

    roomCode = targetPeerId;
    isHost = false;
    hostConnection = null;

    if (hostPeer) {
        hostPeer.destroy();
        hostPeer = null;
    }
    if (clientPeer) {
        clientPeer.destroy();
        clientPeer = null;
    }

    hostPeer = new Peer(targetPeerId);

    hostPeer.on('open', () => {
        isHost = true;
        statusText.innerText = `Sector ${sector} host ready. Peer ID: ${targetPeerId}`;
        startGameAsHost();
    });

    hostPeer.on('connection', (conn) => {
        connections.push(conn);
        conn.on('open', () => {
            console.log('Client connected:', conn.peer);
        });
        conn.on('data', (data) => {
            if (window.gameScene && window.gameScene.handleRemoteInput) {
                window.gameScene.handleRemoteInput(conn.peer, data);
            }
        });
        conn.on('close', () => {
            const idx = connections.indexOf(conn);
            if (idx > -1) connections.splice(idx, 1);
            if (window.gameScene && window.gameScene.removeRemotePlayer) {
                window.gameScene.removeRemotePlayer(conn.peer);
            }
        });
        conn.on('error', (err) => {
            console.warn('Connection error:', err);
        });
    });

    hostPeer.on('error', (err) => {
        const message = (err && (err.message || err.type)) || '';
        const isUnavailableId = err && (
            err.type === 'unavailable-id' ||
            err.type === 'peer-unavailable' ||
            message.toLowerCase().includes('unavailable') ||
            message.toLowerCase().includes('taken')
        );

        if (isUnavailableId) {
            if (hostPeer) {
                hostPeer.destroy();
                hostPeer = null;
            }
            statusText.innerText = `Sector ${sector} is already live. Joining...`;
            joinSector(targetPeerId, sector);
            return;
        }

        statusText.innerText = `Peer error: ${message || 'Unknown error'}`;
        sectorButtons.forEach((button) => {
            button.disabled = false;
        });
    });
}

function joinSector(targetPeerId, sector) {
    isHost = false;
    roomCode = targetPeerId;
    clientPeer = new Peer();

    clientPeer.on('open', () => {
        statusText.innerText = `Connecting to sector ${sector}...`;
        const conn = clientPeer.connect(targetPeerId, { reliable: true });
        hostConnection = conn;

        conn.on('open', () => {
            statusText.innerText = `Connected to sector ${sector}. Starting game...`;
            startGameAsClient(conn);
        });

        conn.on('data', (data) => {
            if (window.gameScene && window.gameScene.receiveState) {
                window.gameScene.receiveState(data);
            }
        });

        conn.on('close', () => {
            statusText.innerText = `Connection to sector ${sector} was lost.`;
            sectorButtons.forEach((button) => {
                button.disabled = false;
            });
        });

        conn.on('error', (err) => {
            statusText.innerText = `Connection error: ${err.message || 'Unable to join sector'}`;
            sectorButtons.forEach((button) => {
                button.disabled = false;
            });
        });
    });

    clientPeer.on('error', (err) => {
        statusText.innerText = `Peer error: ${err.message || 'Unable to create client peer'}`;
        sectorButtons.forEach((button) => {
            button.disabled = false;
        });
    });
}

// ---------- Game Scene ----------
class MainScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MainScene' });
    }

    preload() {
        // ... textures identical to original ...
        let playerGraphics = this.make.graphics({ add: false });
        playerGraphics.fillStyle(0x00ffff, 1);
        playerGraphics.fillTriangle(30, 15, 0, 30, 0, 0);
        playerGraphics.generateTexture('player', 30, 30);

        let guestGraphics = this.make.graphics({ add: false });
        guestGraphics.fillStyle(0x00ff88, 1);
        guestGraphics.fillTriangle(30, 15, 0, 30, 0, 0);
        guestGraphics.generateTexture('guest', 30, 30);

        let enemyGraphics = this.make.graphics({ add: false });
        enemyGraphics.lineStyle(3, 0xff00ff);
        enemyGraphics.strokeRect(2, 2, 26, 26);
        enemyGraphics.fillStyle(0x330033, 1);
        enemyGraphics.fillRect(2, 2, 26, 26);
        enemyGraphics.generateTexture('enemy', 30, 30);

        let bigEnemyGraphics = this.make.graphics({ add: false });
        bigEnemyGraphics.lineStyle(4, 0xff8800);
        bigEnemyGraphics.strokeCircle(25, 25, 23);
        bigEnemyGraphics.fillStyle(0x442200, 1);
        bigEnemyGraphics.fillCircle(25, 25, 23);
        bigEnemyGraphics.generateTexture('bigenemy', 50, 50);

        let bulletGraphics = this.make.graphics({ add: false });
        bulletGraphics.fillStyle(0xffff00, 1);
        bulletGraphics.fillCircle(8, 8, 8);
        bulletGraphics.generateTexture('bullet', 16, 16);

        let gridGraphics = this.make.graphics({ add: false });
        gridGraphics.lineStyle(1, 0x003333, 0.5);
        gridGraphics.strokeRect(0, 0, 100, 100);
        gridGraphics.generateTexture('grid', 100, 100);

        let particleGraphics = this.make.graphics({ add: false });
        particleGraphics.fillStyle(0x00ffff, 1);
        particleGraphics.fillRect(0, 0, 4, 4);
        particleGraphics.generateTexture('particle', 4, 4);
    }

    create() {
        window.gameScene = this; // expose for networking hooks

        this.physics.world.setBounds(0, 0, 2000, 2000);
        this.cameras.main.setBounds(0, 0, 2000, 2000);
        this.add.tileSprite(1000, 1000, 2000, 2000, 'grid');

        this.score = 0;
        this.gameOver = false;
        this.isPaused = false;
        this.lastFired = 0;
        this.fireRate = 120;
        this.gameStarted = false;
        this.countdownValue = 3;

        // Local player (host always has a player; client's own player also exists)
        this.player = this.physics.add.sprite(1000, 1000, isHost ? 'player' : 'guest');
        this.player.setCollideWorldBounds(true);
        this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
        this.localPeerId = (clientPeer && clientPeer.id) ? clientPeer.id : null;

        // Remote players (only host uses this map)
        this.remotePlayers = {}; // key: peerId, value: Phaser.Sprite

        // Groups
        this.bullets = this.physics.add.group({ runChildUpdate: true });
        this.enemies = this.physics.add.group();

        this.emitter = this.add.particles(0, 0, 'particle', {
            speed: { min: 50, max: 200 },
            angle: { min: 0, max: 360 },
            scale: { start: 1, end: 0 },
            blendMode: 'ADD',
            lifespan: 400,
            emitting: false
        });

        this.scoreText = this.add.text(20, 20, 'SCORE: 0 | ROLE: ' + (isHost ? 'HOST (' + roomCode + ')' : 'CLIENT'), {
            fontSize: '20px', fill: '#00ffff', fontFamily: 'Courier', fontStyle: 'bold'
        }).setScrollFactor(0).setDepth(300);

        this.pauseText = this.add.text(this.scale.width / 2, this.scale.height / 2, 'GAME PAUSED', {
            fontSize: '48px', fill: '#ffff00', align: 'center', fontFamily: 'Courier', fontStyle: 'bold'
        }).setOrigin(0.5).setScrollFactor(0).setVisible(false).setDepth(300);

        this.gameOverText = this.add.text(this.scale.width / 2, this.scale.height / 2, 'GAME OVER\nTap to Restart', {
            fontSize: '48px', fill: '#ff00ff', align: 'center', fontFamily: 'Courier', fontStyle: 'bold'
        }).setOrigin(0.5).setScrollFactor(0).setVisible(false).setDepth(300);

        this.countdownText = this.add.text(this.scale.width / 2, this.scale.height / 2 - 60, '3', {
            fontSize: '72px', fill: '#ffff00', align: 'center', fontFamily: 'Courier', fontStyle: 'bold'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(400);

        this.countdownTimer = this.time.addEvent({
            delay: 1000,
            callback: this.tickCountdown,
            callbackScope: this,
            loop: true
        });

        // unlock audio on first input (user gesture requirement)
        this.input.once('pointerdown', () => { if (window.synth) window.synth.unlock(); });

        // Input handling (same as original)
        this.input.addPointer(2);
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys('W,A,S,D');
        this.keyP = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.P);

        this.joyLeftBase = this.add.circle(0, 0, 60, 0x00ffff, 0.2).setVisible(false).setScrollFactor(0).setDepth(100);
        this.joyLeftThumb = this.add.circle(0, 0, 30, 0x00ffff, 0.6).setVisible(false).setScrollFactor(0).setDepth(100);
        this.joyRightBase = this.add.circle(0, 0, 60, 0xff00ff, 0.2).setVisible(false).setScrollFactor(0).setDepth(100);
        this.joyRightThumb = this.add.circle(0, 0, 30, 0xff00ff, 0.6).setVisible(false).setScrollFactor(0).setDepth(100);

        this.leftPointer = null;
        this.rightPointer = null;
        this.leftVector = null;
        this.rightVector = null;

        this.input.on('pointerdown', this.handlePointerDown, this);
        this.input.on('pointermove', this.handlePointerMove, this);
        this.input.on('pointerup', this.handlePointerUp, this);
        this.input.on('pointerout', this.handlePointerUp, this);

        // Host specific setup
        if (isHost) {
            this.enemySpeed = 150;
            this.spawnTimer = this.time.addEvent({ delay: 1000, callback: this.spawnEnemy, callbackScope: this, loop: true });
            this.bigSpawnTimer = this.time.addEvent({ delay: 6000, callback: this.spawnBigEnemy, callbackScope: this, loop: true });

            // Collisions (host only)
            this.physics.add.collider(this.bullets, this.enemies, this.hitEnemy, null, this);
            this.physics.add.collider(this.player, this.enemies, this.hitPlayer, null, this);
            // remote players also collide with enemies
            // We'll dynamically add colliders when remote players join

            // State broadcast timer
            this.broadcastTimer = this.time.addEvent({
                delay: 50,
                callback: this.broadcastState,
                callbackScope: this,
                loop: true
            });
        } else {
            // Client: send input timer (or update loop)
            this.inputTimer = this.time.addEvent({
                delay: 30,
                callback: this.sendInput,
                callbackScope: this,
                loop: true
            });
        }

        this.scale.on('resize', this.resize, this);
    }

    // --- Input handling (same as original) ---
    handlePointerDown(pointer) {
        if (this.gameOver) { if (isHost) this.scene.restart(); return; }
        const halfWidth = this.scale.width / 2;
        if (pointer.x < halfWidth) {
            if (!this.leftPointer) {
                this.leftPointer = pointer;
                this.joyLeftBase.setPosition(pointer.x, pointer.y).setVisible(true);
                this.joyLeftThumb.setPosition(pointer.x, pointer.y).setVisible(true);
                this.leftVector = { x: 0, y: 0 };
            }
        } else {
            if (!this.rightPointer) {
                this.rightPointer = pointer;
                this.joyRightBase.setPosition(pointer.x, pointer.y).setVisible(true);
                this.joyRightThumb.setPosition(pointer.x, pointer.y).setVisible(true);
                this.rightVector = { angle: 0, force: 0 };
            }
        }
    }

    handlePointerMove(pointer) {
        if (this.gameOver || this.isPaused) return;
        const maxRadius = 60;
        if (pointer === this.leftPointer) {
            let dist = Phaser.Math.Distance.Between(this.joyLeftBase.x, this.joyLeftBase.y, pointer.x, pointer.y);
            let angle = Phaser.Math.Angle.Between(this.joyLeftBase.x, this.joyLeftBase.y, pointer.x, pointer.y);
            if (dist > maxRadius) dist = maxRadius;
            this.joyLeftThumb.x = this.joyLeftBase.x + Math.cos(angle) * dist;
            this.joyLeftThumb.y = this.joyLeftBase.y + Math.sin(angle) * dist;
            this.leftVector = { x: Math.cos(angle) * (dist / maxRadius), y: Math.sin(angle) * (dist / maxRadius) };
        } else if (pointer === this.rightPointer) {
            let dist = Phaser.Math.Distance.Between(this.joyRightBase.x, this.joyRightBase.y, pointer.x, pointer.y);
            let angle = Phaser.Math.Angle.Between(this.joyRightBase.x, this.joyRightBase.y, pointer.x, pointer.y);
            if (dist > maxRadius) dist = maxRadius;
            this.joyRightThumb.x = this.joyRightBase.x + Math.cos(angle) * dist;
            this.joyRightThumb.y = this.joyRightBase.y + Math.sin(angle) * dist;
            this.rightVector = { angle: angle, force: dist / maxRadius };
        }
    }

    handlePointerUp(pointer) {
        if (pointer === this.leftPointer) {
            this.leftPointer = null;
            this.joyLeftBase.setVisible(false);
            this.joyLeftThumb.setVisible(false);
            this.leftVector = null;
        } else if (pointer === this.rightPointer) {
            this.rightPointer = null;
            this.joyRightBase.setVisible(false);
            this.joyRightThumb.setVisible(false);
            this.rightVector = null;
        }
    }

    // --- Game logic (host) ---
    tickCountdown() {
        if (this.gameOver || this.isPaused) return;

        this.countdownValue -= 1;
        if (this.countdownValue > 0) {
            this.countdownText.setText(String(this.countdownValue));
            if (window.synth) window.synth.playTick();
        } else {
            this.countdownText.setText('GO!');
            this.gameStarted = true;
            if (window.synth) window.synth.playGo();
            this.countdownTimer.remove(false);
            this.time.delayedCall(500, () => {
                if (this.countdownText && this.countdownText.active) {
                    this.countdownText.destroy();
                }
            });
        }
    }

    spawnEnemy() {
        if (!this.gameStarted || this.gameOver || this.isPaused) return;
        let cam = this.cameras.main;
        let angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
        let dist = Math.max(cam.width, cam.height) / 2 + 100;
        let ex = Phaser.Math.Clamp(this.player.x + Math.cos(angle) * dist, 20, 1980);
        let ey = Phaser.Math.Clamp(this.player.y + Math.sin(angle) * dist, 20, 1980);
        let enemy = this.enemies.create(ex, ey, 'enemy');
        if (enemy) {
            enemy.setData('type', 'normal');
            enemy.setData('hp', 1);
            enemy.setBounce(1);
            enemy.setCollideWorldBounds(true);
            if (window.synth && isHost) window.synth.playHit();
        }
    }

    spawnBigEnemy() {
        if (!this.gameStarted || this.gameOver || this.isPaused) return;
        let cam = this.cameras.main;
        let angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
        let dist = Math.max(cam.width, cam.height) / 2 + 150;
        let ex = Phaser.Math.Clamp(this.player.x + Math.cos(angle) * dist, 40, 1960);
        let ey = Phaser.Math.Clamp(this.player.y + Math.sin(angle) * dist, 40, 1960);
        let enemy = this.enemies.create(ex, ey, 'bigenemy');
        if (enemy) {
            enemy.setData('type', 'big');
            enemy.setData('hp', 5);
            enemy.setBounce(1);
            enemy.setCollideWorldBounds(true);
            if (window.synth && isHost) window.synth.playBigSpawn();
        }
    }

    hitEnemy(bullet, enemy) {
        bullet.destroy();
        let hp = enemy.getData('hp') - 1;
        enemy.setData('hp', hp);
        if (hp <= 0) {
            this.emitter.explode(10, enemy.x, enemy.y);
            enemy.destroy();
            this.score += (enemy.getData('type') === 'big' ? 50 : 10);
            this.scoreText.setText('SCORE: ' + this.score + ' | ROLE: HOST (' + roomCode + ')');
            if (window.synth && isHost) window.synth.playExplosion();
        } else {
            enemy.setTint(0xffffff);
            this.time.delayedCall(50, () => { if (enemy && enemy.active) enemy.clearTint(); });
        }
        this.cameras.main.shake(30, 0.003);
    }

    respawnPlayer(player) {
        if (!player || !player.active) return;

        const spawnX = 1000 + Phaser.Math.Between(-200, 200);
        const spawnY = 1000 + Phaser.Math.Between(-200, 200);

        player.setData('isDead', false);
        player.clearTint();
        player.setVisible(true);
        player.body.enable = true;
        player.body.reset(spawnX, spawnY);
        player.setVelocity(0, 0);
    }

    handlePlayerDeath(player) {
        if (!player || !player.active || player.getData('isDead')) return;

        player.setData('isDead', true);
        player.setTint(0xff0000);
        player.setVelocity(0, 0);
        player.body.enable = false;
        player.setVisible(false);
        this.emitter.explode(30, player.x, player.y);
        if (window.synth) window.synth.playDeath();

        this.time.delayedCall(5000, () => {
            if (!player || !player.active) return;
            this.respawnPlayer(player);
        });
    }

    hitPlayer(player, enemy) {
        if (this.gameOver) return;
        this.handlePlayerDeath(player);
    }

    getAlivePlayers() {
        const alivePlayers = [];
        if (this.player && this.player.active && !this.player.getData('isDead')) {
            alivePlayers.push(this.player);
        }
        for (let id in this.remotePlayers) {
            const rp = this.remotePlayers[id];
            if (rp && rp.active && !rp.getData('isDead')) {
                alivePlayers.push(rp);
            }
        }
        return alivePlayers;
    }

    // --- Networking: Host side ---
    handleRemoteInput(peerId, data) {
        if (!isHost || this.gameOver) return;
        // Store input for that remote player
        if (!this.remotePlayers[peerId]) {
            // Create remote player sprite
            let rp = this.physics.add.sprite(1000, 1000, 'guest');
            rp.setCollideWorldBounds(true);
            this.remotePlayers[peerId] = rp;
            // Add collider against enemies
            this.physics.add.collider(rp, this.enemies, this.hitPlayer, null, this);
        }
        // Update remote player's target movement and shooting from data
        let rp = this.remotePlayers[peerId];
        rp.setData('moveX', data.moveX || 0);
        rp.setData('moveY', data.moveY || 0);
        rp.setData('aimAngle', data.aimAngle || 0);
        rp.setData('shoot', data.shoot || false);
        rp.setData('lastFired', rp.getData('lastFired') || 0);
    }

    removeRemotePlayer(peerId) {
        if (this.remotePlayers[peerId]) {
            this.remotePlayers[peerId].destroy();
            delete this.remotePlayers[peerId];
        }
    }

    broadcastState() {
        if (!isHost || !connections.length) return;
        // Build snapshot
        const players = {};
        // host player
        players['host'] = { x: this.player.x, y: this.player.y, r: this.player.rotation, isDead: !!this.player.getData('isDead') };
        // remote players
        for (let id in this.remotePlayers) {
            let rp = this.remotePlayers[id];
            players[id] = { x: rp.x, y: rp.y, r: rp.rotation, isDead: !!rp.getData('isDead') };
        }

        const state = {
            type: 'state',
            score: this.score,
            players: players,
            enemies: this.enemies.getChildren().map(e => ({
                x: e.x, y: e.y, type: e.getData('type'), r: e.rotation
            })),
            bullets: this.bullets.getChildren().map(b => ({ x: b.x, y: b.y })),
        };

        // Send to all connections
        connections.forEach(conn => conn.send(state));
    }

    // --- Networking: Client side ---
    sendInput() {
        if (isHost) return;
        if (!hostConnection || !hostConnection.open) return;

        let moveX = 0, moveY = 0;
        if (this.leftVector) {
            moveX = this.leftVector.x;
            moveY = this.leftVector.y;
        } else {
            if (this.cursors.left.isDown || this.wasd.A.isDown) moveX = -1;
            if (this.cursors.right.isDown || this.wasd.D.isDown) moveX = 1;
            if (this.cursors.up.isDown || this.wasd.W.isDown) moveY = -1;
            if (this.cursors.down.isDown || this.wasd.S.isDown) moveY = 1;
        }
        let shoot = false;
        let aimAngle = 0;
        if (this.rightVector && this.rightVector.force > 0.2) {
            shoot = true;
            aimAngle = this.rightVector.angle;
        } else if (this.input.activePointer.isDown && !this.leftPointer && !this.rightPointer) {
            shoot = true;
            aimAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y,
                this.input.activePointer.worldX, this.input.activePointer.worldY);
        }

        hostConnection.send({
            type: 'input',
            moveX, moveY, shoot, aimAngle
        });
    }

    receiveState(data) {
        if (isHost || !data || data.type !== 'state') return;
        // Update score display
        this.scoreText.setText('SCORE: ' + data.score + ' | ROLE: CLIENT');

        // Sync enemies
        this.enemies.clear(true, true);
        data.enemies.forEach(ed => {
            let en = this.enemies.create(ed.x, ed.y, ed.type === 'big' ? 'bigenemy' : 'enemy');
            en.rotation = ed.r;
        });

        // Sync bullets
        this.bullets.clear(true, true);
        data.bullets.forEach(bd => {
            let bul = this.bullets.create(bd.x, bd.y, 'bullet');
        });

        // Sync players (host + remote)
        // Update our own player's position (to reflect what host thinks, but we also move locally)
        if (data.players) {
            for (let id in data.players) {
                const playerState = data.players[id];
                const isDead = !!(playerState && playerState.isDead);

                if (id === 'host') {
                    // Host's player in world – we can show a separate sprite for host
                    if (!this.hostPlayerSprite) {
                        this.hostPlayerSprite = this.add.sprite(playerState.x, playerState.y, 'player');
                        this.hostPlayerSprite.setDepth(2);
                    }
                    this.hostPlayerSprite.setPosition(playerState.x, playerState.y);
                    this.hostPlayerSprite.rotation = playerState.r;
                    this.hostPlayerSprite.setVisible(!isDead);
                } else if (id === this.localPeerId) {
                    // Our own client player state from host
                    if (this.player) {
                        this.player.setData('isDead', isDead);
                        this.player.setVisible(!isDead);
                        if (!isDead) {
                            this.player.setPosition(playerState.x, playerState.y);
                            this.player.rotation = playerState.r;
                        }
                    }
                } else if (id !== 'host' && id !== this.localPeerId) {
                    // Other remote players (not us)
                    if (!this.otherRemoteSprites) this.otherRemoteSprites = {};
                    if (!this.otherRemoteSprites[id]) {
                        let spr = this.add.sprite(playerState.x, playerState.y, 'guest');
                        spr.setDepth(2);
                        this.otherRemoteSprites[id] = spr;
                    }
                    this.otherRemoteSprites[id].setPosition(playerState.x, playerState.y);
                    this.otherRemoteSprites[id].rotation = playerState.r;
                    this.otherRemoteSprites[id].setVisible(!isDead);
                }
            }
            // Remove sprites of disconnected players
            for (let id in this.otherRemoteSprites) {
                if (!data.players[id]) {
                    this.otherRemoteSprites[id].destroy();
                    delete this.otherRemoteSprites[id];
                }
            }
        }
    }

    resize(gameSize) {
        if (this.gameOverText) this.gameOverText.setPosition(gameSize.width / 2, gameSize.height / 2);
        if (this.pauseText) this.pauseText.setPosition(gameSize.width / 2, gameSize.height / 2);
        if (this.countdownText) this.countdownText.setPosition(gameSize.width / 2, gameSize.height / 2 - 60);
    }

    update(time, delta) {
        if (Phaser.Input.Keyboard.JustDown(this.keyP)) {
            this.isPaused = !this.isPaused;
            this.pauseText.setVisible(this.isPaused);
            if (this.isPaused) this.physics.pause();
            else if (!this.gameOver) this.physics.resume();
        }

        if (this.gameOver || this.isPaused || !this.gameStarted) return;

        // Movement (local player)
        let moveX = 0, moveY = 0;
        if (!this.player.getData('isDead')) {
            if (this.leftVector) {
                moveX = this.leftVector.x;
                moveY = this.leftVector.y;
            } else {
                if (this.cursors.left.isDown || this.wasd.A.isDown) moveX = -1;
                if (this.cursors.right.isDown || this.wasd.D.isDown) moveX = 1;
                if (this.cursors.up.isDown || this.wasd.W.isDown) moveY = -1;
                if (this.cursors.down.isDown || this.wasd.S.isDown) moveY = 1;
                if (moveX !== 0 && moveY !== 0) {
                    let len = Math.sqrt(moveX*moveX + moveY*moveY);
                    moveX /= len; moveY /= len;
                }
            }

            const speed = 350;
            this.player.setVelocity(moveX * speed, moveY * speed);

            // Aiming & Shooting (local)
            let isShooting = false;
            let aimAngle = 0;
            if (this.rightVector && this.rightVector.force > 0.2) {
                isShooting = true;
                aimAngle = this.rightVector.angle;
            } else if (this.input.activePointer.isDown && !this.leftPointer && !this.rightPointer) {
                isShooting = true;
                aimAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y,
                    this.input.activePointer.worldX, this.input.activePointer.worldY);
            }

            if (isShooting) {
                this.player.rotation = aimAngle;
                if (time > this.lastFired) {
                    let bullet = this.bullets.create(this.player.x, this.player.y, 'bullet');
                    if (bullet) {
                        bullet.setActive(true).setVisible(true);
                        this.physics.velocityFromRotation(aimAngle, 1000, bullet.body.velocity);
                        bullet.rotation = aimAngle;
                        bullet.born = 0;
                        bullet.update = function(t, d) {
                            this.born += d;
                            if (this.born > 1500) this.destroy();
                        };
                    }
                    this.lastFired = time + this.fireRate;
                }
            } else if (moveX !== 0 || moveY !== 0) {
                this.player.rotation = Math.atan2(moveY, moveX);
            }
        } else {
            this.player.setVelocity(0, 0);
        }

        // Host: update remote players and enemy AI
        if (isHost) {
            const speed = 350;
            // Move remote players according to their last input
            for (let id in this.remotePlayers) {
                let rp = this.remotePlayers[id];
                if (rp.getData('isDead')) {
                    rp.setVelocity(0, 0);
                    continue;
                }

                let mx = rp.getData('moveX') || 0;
                let my = rp.getData('moveY') || 0;
                rp.setVelocity(mx * speed, my * speed);
                                if (window.synth) window.synth.playShot();

                if (mx !== 0 || my !== 0) rp.rotation = Math.atan2(my, mx);

                // Shooting for remote
                if (rp.getData('shoot') && time > rp.getData('lastFired')) {
                    let angle = rp.getData('aimAngle') || 0;
                    let bul = this.bullets.create(rp.x, rp.y, 'bullet');
                    if (bul) {
                        bul.setActive(true).setVisible(true);
                        this.physics.velocityFromRotation(angle, 1000, bul.body.velocity);
                        bul.rotation = angle;
                        bul.born = 0;
                        bul.update = function(t, d) {
                            this.born += d;
                            if (this.born > 1500) this.destroy();
                        };
                        if (window.synth) window.synth.playShot();
                    }
                    rp.setData('lastFired', time + this.fireRate);
                }
            }

            // Enemy AI
            const alivePlayers = this.getAlivePlayers();
            this.enemies.getChildren().forEach(enemy => {
                if (!enemy.active) return;

                let target = null;
                let minDist = Infinity;
                alivePlayers.forEach(player => {
                    if (!player || !player.active) return;
                    const d = Phaser.Math.Distance.Between(enemy.x, enemy.y, player.x, player.y);
                    if (d < minDist) {
                        minDist = d;
                        target = player;
                    }
                });

                if (!target || minDist > 600) {
                    let wanderDirection = enemy.getData('wanderDirection') || 0;
                    let nextTurnAt = enemy.getData('nextTurnAt') || 0;
                    if (time > nextTurnAt) {
                        wanderDirection = Phaser.Math.FloatBetween(0, Math.PI * 2);
                        enemy.setData('wanderDirection', wanderDirection);
                        enemy.setData('nextTurnAt', time + 800);
                    }
                    this.physics.velocityFromRotation(wanderDirection, 80, enemy.body.velocity);
                    enemy.rotation = wanderDirection;
                } else {
                    this.physics.moveToObject(enemy, target, 150);
                    enemy.rotation += 0.05;
                }
            });
        }
    }
}

// ---------- Start functions ----------
function startGameAsHost() {
    document.getElementById('lobby-overlay').style.display = 'none';
    const config = {
        type: Phaser.AUTO,
        scale: { mode: Phaser.Scale.RESIZE, parent: 'game-container', width: '100%', height: '100%' },
        physics: { default: 'arcade', arcade: { gravity: { y: 0 }, debug: false } },
        scene: MainScene
    };
    new Phaser.Game(config);
}

function startGameAsClient(conn) {
    document.getElementById('lobby-overlay').style.display = 'none';
    const config = {
        type: Phaser.AUTO,
        scale: { mode: Phaser.Scale.RESIZE, parent: 'game-container', width: '100%', height: '100%' },
        physics: { default: 'arcade', arcade: { gravity: { y: 0 }, debug: false } },
        scene: MainScene
    };
    new Phaser.Game(config);
}
