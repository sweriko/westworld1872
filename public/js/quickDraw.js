/**
 * Quick Draw game mode implementation
 * Players face off in a wild west duel where they must wait for the "draw" signal
 * before pulling their revolvers and shooting at each other.
 * Now with direct player-to-player challenges directly on the town map.
 */

import { PhysicsSystem } from './physics.js';
import { createOptimizedSmokeEffect } from './input.js';
import { updateHealthUI } from './ui.js';
import { FlyingEagle } from './flyingEagle.js';

export class QuickDraw {
    constructor(scene, localPlayer, networkManager, soundManager) {
        // Assign passed parameters
        this.scene = scene;
        this.localPlayer = localPlayer;
        this.networkManager = networkManager;
        this.soundManager = soundManager;
        
        // Initialize state variables
        this.inDuel = false;
        this.inLobby = false;
        this.duelState = 'none';
        this.duelOpponentId = null;
        this.pendingChallenge = null;
        this.duelActive = false;
        
        // Initialize nametag tracking
        this.originalLabelDisplays = new Map();
        
        // Ensure window.multiplayerManager is set
        this.ensureMultiplayerManagerAccess();
        
        // Aerial camera properties
        this.aerialCamera = null;
        this.aerialCameraAngle = 0;
        this.aerialCameraActive = false;
        this.aerialCameraPathSet = false;
        this.originalCamera = null;
        
        // Flag to track when player is in death/kill animation
        this.inDeathOrKillAnimation = false;
        
        // Create UI elements
        this.createUI();
        
        // Detect mobile devices if not already set
        if (window.isMobileDevice === undefined) {
            window.isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        }
        
        // Initialize mouse tracking for right-click detection
        if (!window.mouseDown) {
            window.mouseDown = { left: false, right: false };
            
            document.addEventListener('mousedown', (event) => {
                if (event.button === 0) {
                    window.mouseDown.left = true;
                } else if (event.button === 2) {
                    window.mouseDown.right = true;
                }
            });
            
            document.addEventListener('mouseup', (event) => {
                if (event.button === 0) {
                    window.mouseDown.left = false;
                } else if (event.button === 2) {
                    window.mouseDown.right = false;
                }
            });
            
            // Also track when pointer leaves window
            document.addEventListener('pointerleave', () => {
                window.mouseDown.left = false;
                window.mouseDown.right = false;
            });
        }
        
        // Game state
        this.gunLocked = false;
        this.originalCanAim = true;
        // Record the time (in ms) until which the gun remains locked
        this.penaltyEndTime = 0;
        
        // Direct challenge system
        this.playerProximityRadius = 5; // 5 units radius for challenge detection
        this.nearbyPlayers = new Map(); // Map of nearby player IDs to their data
        this.challengePromptActive = false; // Whether the challenge prompt is active
        
        // Initialize physics system for collision detection
        this.physics = new PhysicsSystem();
        
        // Initialize the network handlers and challenge UI
        this.initNetworkHandlers();
        this.createUI();
        this.createChallengeUI();

        // Make this instance globally accessible for network handlers
        window.quickDraw = this;

        // Third-person model for local player (only visible during aerial view)
        this.localPlayerModel = null;

        // Initialize collections
        this.outgoingChallenges = new Map(); // Track outgoing challenges by playerId
        this.inviteCooldowns = new Map(); // Track cooldowns for accepted invites
    }
    
    /**
     * Create UI elements for Quick Draw game mode.
     */
    createUI() {
        // Text overlay for messages
        this.messageOverlay = document.createElement('div');
        this.messageOverlay.id = 'quick-draw-message';
        this.messageOverlay.style.position = 'absolute';
        this.messageOverlay.style.top = '50%';
        this.messageOverlay.style.left = '50%';
        this.messageOverlay.style.transform = 'translate(-50%, -50%)';
        this.messageOverlay.style.color = 'white';
        this.messageOverlay.style.fontSize = '48px';
        this.messageOverlay.style.fontWeight = 'bold';
        this.messageOverlay.style.textAlign = 'center';
        this.messageOverlay.style.display = 'none';
        this.messageOverlay.style.fontFamily = 'Western, Arial, sans-serif';
        this.messageOverlay.style.textShadow = '2px 2px 4px rgba(0, 0, 0, 0.5)';
        this.messageOverlay.style.zIndex = '1000';
        document.getElementById('game-container').appendChild(this.messageOverlay);
        
        // Draw circle animation
        this.drawCircle = document.createElement('div');
        this.drawCircle.id = 'draw-circle';
        this.drawCircle.style.position = 'absolute';
        this.drawCircle.style.top = '50%';
        this.drawCircle.style.left = '50%';
        this.drawCircle.style.transform = 'translate(-50%, -50%) scale(0)';
        this.drawCircle.style.width = '600px';
        this.drawCircle.style.height = '600px';
        this.drawCircle.style.borderRadius = '50%';
        this.drawCircle.style.border = '8px solid #FF0000';
        this.drawCircle.style.boxShadow = '0 0 20px #FF0000';
        this.drawCircle.style.opacity = '0';
        this.drawCircle.style.transition = 'transform 0.3s, opacity 0.3s';
        this.drawCircle.style.pointerEvents = 'none';
        this.drawCircle.style.zIndex = '999';
        this.drawCircle.style.display = 'none';
        document.getElementById('game-container').appendChild(this.drawCircle);
        
        // Add status indicator
        this.statusIndicator = document.createElement('div');
        this.statusIndicator.id = 'quick-draw-status';
        this.statusIndicator.style.position = 'absolute';
        this.statusIndicator.style.top = '120px';
        this.statusIndicator.style.left = '20px';
        this.statusIndicator.style.color = 'white';
        this.statusIndicator.style.fontSize = '16px';
        this.statusIndicator.style.backgroundColor = 'rgba(0,0,0,0.5)';
        this.statusIndicator.style.padding = '5px';
        this.statusIndicator.style.borderRadius = '5px';
        this.statusIndicator.style.display = 'none';
        document.getElementById('game-container').appendChild(this.statusIndicator);
        
        // Health bar container
        this.healthBarContainer = document.createElement('div');
        this.healthBarContainer.id = 'health-bar-container';
        this.healthBarContainer.style.position = 'absolute';
        this.healthBarContainer.style.top = '20px';
        this.healthBarContainer.style.left = '50%';
        this.healthBarContainer.style.transform = 'translateX(-50%)';
        this.healthBarContainer.style.width = '300px';
        this.healthBarContainer.style.height = '30px';
        this.healthBarContainer.style.backgroundColor = 'rgba(0,0,0,0.5)';
        this.healthBarContainer.style.borderRadius = '5px';
        this.healthBarContainer.style.padding = '5px';
        this.healthBarContainer.style.display = 'none';
        this.healthBarContainer.style.zIndex = '1000';
        
        // Health bar
        this.healthBar = document.createElement('div');
        this.healthBar.id = 'health-bar';
        this.healthBar.style.width = '100%';
        this.healthBar.style.height = '100%';
        this.healthBar.style.backgroundColor = '#00FF00';
        this.healthBar.style.borderRadius = '3px';
        this.healthBar.style.transition = 'width 0.3s ease-in-out';
        
        // Health text
        this.healthText = document.createElement('div');
        this.healthText.id = 'health-text';
        this.healthText.style.position = 'absolute';
        this.healthText.style.top = '50%';
        this.healthText.style.left = '50%';
        this.healthText.style.transform = 'translate(-50%, -50%)';
        this.healthText.style.color = 'white';
        this.healthText.style.fontSize = '14px';
        this.healthText.style.fontWeight = 'bold';
        this.healthText.style.textShadow = '1px 1px 2px black';
        this.healthText.textContent = '100 HP';
        
        // Assemble health bar
        this.healthBarContainer.appendChild(this.healthBar);
        this.healthBarContainer.appendChild(this.healthText);
        document.getElementById('game-container').appendChild(this.healthBarContainer);
    }
    
    /**
     * Create UI elements specific to the direct challenge system
     */
    createChallengeUI() {
        // Challenge prompt - shown when near another player
        this.challengePrompt = document.createElement('div');
        this.challengePrompt.id = 'quick-draw-challenge-prompt';
        this.challengePrompt.style.position = 'absolute';
        this.challengePrompt.style.bottom = '20%';
        this.challengePrompt.style.left = '50%';
        this.challengePrompt.style.transform = 'translate(-50%, 0) rotate(-2deg)';
        this.challengePrompt.style.width = '350px';
        this.challengePrompt.style.height = '100px';
        this.challengePrompt.style.background = 'url("/textures/wooden_sign.png") no-repeat center center';
        this.challengePrompt.style.backgroundSize = 'contain';
        this.challengePrompt.style.display = 'flex';
        this.challengePrompt.style.alignItems = 'center';
        this.challengePrompt.style.justifyContent = 'center';
        this.challengePrompt.style.zIndex = '1000';
        
        const promptText = document.createElement('div');
        promptText.textContent = 'Press E to DUEL';
        promptText.style.fontFamily = 'Western, "Wanted M54", serif';
        promptText.style.fontSize = '28px';
        promptText.style.fontWeight = 'bold';
        promptText.style.color = '#FFD700';
        promptText.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
        
        this.challengePrompt.appendChild(promptText);
        document.getElementById('game-container').appendChild(this.challengePrompt);
        this.challengePrompt.style.display = 'none'; // Hide initially
        
        // Add gentle swing animation
        const promptAnimation = document.createElement('style');
        promptAnimation.textContent = `
            @keyframes prompt-swing {
                0% { transform: translate(-50%, 0) rotate(-2deg); }
                50% { transform: translate(-50%, 0) rotate(1deg); }
                100% { transform: translate(-50%, 0) rotate(-2deg); }
            }
            #quick-draw-challenge-prompt {
                animation: prompt-swing 3s ease-in-out infinite;
            }
        `;
        document.head.appendChild(promptAnimation);
        
        // Add responsive styles for the invitation panel
        const inviteStyles = document.createElement('style');
        inviteStyles.textContent = `
            @media screen and (max-width: 768px) {
                #quick-draw-invitation {
                    width: 90% !important;
                    height: auto !important;
                    aspect-ratio: 500/333;
                }
            }
        `;
        document.head.appendChild(inviteStyles);
        
        // Create the invitation panel - just using the image
        this.challengeInvitation = document.createElement('div');
        this.challengeInvitation.id = 'quick-draw-invitation';
        this.challengeInvitation.style.position = 'absolute';
        this.challengeInvitation.style.top = '50%';
        this.challengeInvitation.style.left = '50%';
        this.challengeInvitation.style.transform = 'translate(-50%, -50%)';
        this.challengeInvitation.style.width = '500px';
        this.challengeInvitation.style.height = '333px';
        this.challengeInvitation.style.background = 'url("/models/invitepanel.png") no-repeat center center';
        this.challengeInvitation.style.backgroundSize = 'contain';
        this.challengeInvitation.style.zIndex = '1100';
        this.challengeInvitation.style.display = 'none'; // Hide initially
        
        document.getElementById('game-container').appendChild(this.challengeInvitation);
        
        // Add keyboard event listener for challenge interactions
        document.addEventListener('keydown', (event) => this.handleChallengeKeypress(event));
    }
    
    /**
     * Handle keypresses for the challenge system
     * @param {KeyboardEvent} event - The keyboard event
     */
    handleChallengeKeypress(event) {
        // Skip if not in game or if player is in lobby/duel
        if (!this.localPlayer || this.inLobby || this.inDuel) return;
        
        // Remove excessive key press logging
        
        switch (event.code) {
            case 'KeyE':
                // Send challenge when near a player
                if (this.challengePromptActive) {
                    console.log('[QuickDraw] E key pressed - sending challenge');
                    this.sendChallenge();
                }
                break;
                
            case 'Enter':
            case 'NumpadEnter': // Also handle numpad enter
                // Accept invitation
                if (this.pendingChallenge) {
                    console.log('[QuickDraw] Enter key pressed - accepting challenge');
                    this.acceptChallenge();
                }
                break;
                
            case 'KeyT':
                // Decline invitation
                if (this.pendingChallenge) {
                    console.log('[QuickDraw] T key pressed - declining challenge');
                    this.declineChallenge();
                }
                break;
        }
    }
    
    /**
     * Initialize network handlers for Quick Draw game mode.
     */
    initNetworkHandlers() {
        if (!this.networkManager || !this.networkManager.socket) return;
        
        // Methods for direct challenges and server communication
        this.networkManager.sendQuickDrawChallenge = (targetPlayerId) => {
            if (this.networkManager.socket && this.networkManager.socket.readyState === WebSocket.OPEN) {
                this.networkManager.socket.send(JSON.stringify({
                    type: 'quickDrawChallenge',
                    targetPlayerId: targetPlayerId
                }));
            }
        };
        
        this.networkManager.sendQuickDrawAccept = (challengerId) => {
            if (this.networkManager.socket && this.networkManager.socket.readyState === WebSocket.OPEN) {
                this.networkManager.socket.send(JSON.stringify({
                    type: 'quickDrawAccept',
                    challengerId: challengerId
                }));
            }
        };
        
        this.networkManager.sendQuickDrawDecline = (challengerId) => {
            if (this.networkManager.socket && this.networkManager.socket.readyState === WebSocket.OPEN) {
                this.networkManager.socket.send(JSON.stringify({
                    type: 'quickDrawDecline',
                    challengerId: challengerId
                }));
            }
        };
        
        this.networkManager.sendQuickDrawShoot = (opponentId, arenaIndex, hitZone = 'body', damage = 40, hitDetected = false) => {
            if (this.networkManager.socket && this.networkManager.socket.readyState === WebSocket.OPEN) {
                // Use logger instead of console.log
                if (window.logger) {
                    window.logger.debug(`Sending Quick Draw hit notification to server: player ${this.localPlayer.id} hit player ${opponentId} in the ${hitZone} for ${damage} damage`);
                }
                this.networkManager.socket.send(JSON.stringify({
                    type: 'quickDrawShoot',
                    opponentId: opponentId,
                    arenaIndex: arenaIndex,
                    hitZone: hitZone,
                    damage: damage,
                    hitDetected: hitDetected // Add this flag to let server know a hit was properly detected
                }));
            }
        };
        
        this.networkManager.sendQuickDrawReady = () => {
            if (this.networkManager.socket && this.networkManager.socket.readyState === WebSocket.OPEN) {
                this.networkManager.socket.send(JSON.stringify({
                    type: 'quickDrawReady'
                }));
            }
        };
        
        this.networkManager.sendQuickDrawPenalty = () => {
            if (this.networkManager.socket && this.networkManager.socket.readyState === WebSocket.OPEN) {
                this.networkManager.socket.send(JSON.stringify({
                    type: 'quickDrawPenalty'
                }));
            }
        };
        
        // Hook into the existing socket onmessage handler
        const originalOnMessage = this.networkManager.socket.onmessage;
        this.networkManager.socket.onmessage = (event) => {
            // Call original handler
            if (originalOnMessage) {
                originalOnMessage(event);
            }
            
            try {
                const message = JSON.parse(event.data);
                
                // Debug log for QuickDraw related messages
                if (message.type && message.type.startsWith('quickDraw')) {
                    console.log(`[QuickDraw] Received message: ${message.type}`, message);
                }
                
                // Handle Quick Draw specific messages
                switch (message.type) {
                    case 'quickDrawMatchFound':
                    case 'quickDrawMatch':  // Handle both formats for compatibility
                        console.log('[QuickDraw] Match found!', message);
                        this.handleMatchFound(message);
                        
                        // Clear any pending challenge since we're now in a match
                        this.pendingChallenge = null;
                        break;
                        
                    case 'quickDrawReady':
                        console.log('[QuickDraw] Ready signal received');
                        this.showReadyMessage();
                        break;
                        
                    case 'quickDrawCountdown':
                        console.log('[QuickDraw] Countdown signal received');
                        this.handleCountdown(message);
                        break;
                        
                    case 'quickDrawDraw':
                        console.log('[QuickDraw] Received DRAW command from server');
                        
                        // Set duel state to draw phase
                        this.duelState = 'draw';
                        
                        // Stop any countdown timer
                        if (this._countdownInterval) {
                            clearInterval(this._countdownInterval);
                            this._countdownInterval = null;
                        }
                        
                        // CRITICAL: Enable player aiming to allow drawing weapon
                        if (this.localPlayer) {
                            console.log('[QuickDraw] Enabling player aiming for draw phase');
                            this.localPlayer.canAim = true;
                        }
                        
                        // Switch to first person view (emergency direct camera switch)
                        if (this.localPlayer && this.localPlayer.camera) {
                            // Force camera to player's view
                            if (this.scene && this.scene.renderer) {
                                this.scene.renderer.camera = this.localPlayer.camera;
                                this.scene.renderer.overrideCamera = null;
                            }
                        }
                        
                        // Ensure gun is visible but holstered
                        if (this.localPlayer && this.localPlayer.viewmodel) {
                            // Make gun visible
                            this.localPlayer.viewmodel.visible = true;
                            
                            // Update gun state (without forcing aiming to false)
                            if (this.localPlayer.currentGunOffset && this.localPlayer.holsterOffset && !this.localPlayer.isAiming) {
                                this.localPlayer.currentGunOffset.copy(this.localPlayer.holsterOffset);
                            }
                        }
                        
                        // Hide local player model in first person
                        if (this.localPlayerModel && this.localPlayerModel.group) {
                            this.localPlayerModel.group.visible = false;
                        }
                        
                        // Play eagle scream for the draw command
                        if (this.soundManager) {
                            this.soundManager.playSound("eaglescream", 0, 1.0);
                        }
                        
                        // Check hit zones for proper detection
                        this.fixHitZonesForQuickDraw();
                        
                        break;
                        
                    case 'quickDrawKill':
                        this.handleKill(message);
                        break;
                        
                    case 'quickDrawDeath':
                        this.handleDeath(message);
                        break;
                        
                    case 'quickDrawResult':
                    case 'quickDrawEnd':  // Handle both formats for compatibility
                        this.handleResult(message);
                        break;
                        
                    case 'respawn':
                        // Handle server-initiated respawn after quickdraw match
                        console.log('[QuickDraw] Received respawn message from server');
                        
                        if (this.localPlayer) {
                            // Set player position from server
                            if (message.position) {
                                this.localPlayer.group.position.set(
                                    message.position.x,
                                    message.position.y,
                                    message.position.z
                                );
                                console.log(`[QuickDraw] Player respawned at server position: (${message.position.x.toFixed(2)}, ${message.position.y.toFixed(2)}, ${message.position.z.toFixed(2)})`);
                            }
                            
                            // Set active weapon if provided by server
                            if (message.activeWeapon && (message.activeWeapon === 'revolver' || message.activeWeapon === 'shotgun')) {
                                // Only switch if different from current
                                if (this.localPlayer.activeWeapon !== message.activeWeapon) {
                                    this.localPlayer.switchWeapon(message.activeWeapon);
                                }
                            }
                            
                            // Reset all weapon ammo to maximum
                            this.localPlayer.weaponAmmo = {
                                revolver: this.localPlayer.weaponStats.revolver.maxBullets,
                                shotgun: this.localPlayer.weaponStats.shotgun.maxBullets
                            };
                            
                            // Set the active weapon's bullet count
                            this.localPlayer.bullets = this.localPlayer.weaponAmmo[this.localPlayer.activeWeapon];
                            this.localPlayer.maxBullets = this.localPlayer.weaponStats[this.localPlayer.activeWeapon].maxBullets;
                            
                            // Cancel any ongoing reloading
                            if (this.localPlayer.isReloading) {
                                // Cancel reload animation
                                if (this.localPlayer.viewmodel) {
                                    this.localPlayer.viewmodel.cancelReload();
                                }
                                
                                // Hide reload UI elements
                                const reloadProgressContainer = document.getElementById('reload-progress-container');
                                if (reloadProgressContainer) reloadProgressContainer.style.display = 'none';
                            }
                            
                            // Reset health
                            this.localPlayer.health = message.health || 100;
                            
                            // Reset states
                            this.localPlayer.isReloading = false;
                            this.localPlayer.isAiming = false;
                            this.localPlayer.velocity.y = 0;
                            this.localPlayer.canAim = true;
                            this.localPlayer.canMove = true;
                            this.localPlayer.canShoot = true;
                            
                            // Update UI
                            if (typeof updateHealthUI === 'function') {
                                updateHealthUI(this.localPlayer);
                            }
                            
                            if (typeof updateAmmoUI === 'function') {
                                updateAmmoUI(this.localPlayer);
                            }
                            
                            console.log(`[QuickDraw] Respawn complete - Current weapon: ${this.localPlayer.activeWeapon}, Ammo: ${this.localPlayer.bullets}/${this.localPlayer.maxBullets}`);
                        }
                        
                        // Ensure we're not in a duel state
                        this.inDuel = false;
                        this.inLobby = false;
                        this.duelState = 'none';
                        this.duelActive = false;
                        break;
                        
                    case 'fullStateReset':
                        // New comprehensive server-directed reset 
                        console.log('[QuickDraw] Received full state reset command from server');
                        this.resetPlayerAndRespawn(message);
                        break;
                        
                    case 'quickDrawChallengeReceived':
                        this.handleChallengeReceived(message);
                        break;
                        
                    case 'quickDrawChallengeAccepted':
                        this.handleChallengeAccepted(message);
                        break;
                        
                    case 'quickDrawChallengeDeclined':
                        this.handleChallengeDeclined(message);
                        break;
                    
                    case 'quickDrawAccepted':
                    case 'quickDrawAccept':
                        // Handle server confirmation of challenge acceptance
                        console.log('[QuickDraw] Challenge acceptance confirmed by server');
                        // The match will be set up by the server and we'll receive a matchFound message
                        break;
                        
                    case 'debug':
                        // Display debug messages from server
                        console.log(`[DEBUG] Server message: ${message.message}`);
                        // Show on-screen for easier debugging
                        if (message.message.includes('hit detection')) {
                            this.showMessage(`DEBUG: ${message.message}`, 3000, '#ff9900');
                        }
                        break;
                        
                    case 'quickDrawMiss':
                        // Handle explicit miss notifications
                        console.log(`[QuickDraw] Player ${message.playerId} missed shot at player ${message.targetId}`);
                        // No visual feedback for misses per user request
                        break;
                        
                    case 'playerHealthUpdate':
                        // Only handle playerHealthUpdate if we're in a duel and it's related to us
                        if (this.inDuel && 
                            (message.playerId === this.localPlayer.id || message.playerId === this.duelOpponentId)) {
                            
                            // Initialize health update tracking if it doesn't exist
                            if (!this.healthUpdateTracking) {
                                this.healthUpdateTracking = new Map();
                            }
                            
                            // Create a unique ID for this health update to prevent duplicates
                            const updateId = `${message.playerId}_${message.health}_${Date.now()}`;
                            
                            // Update own health if it's us
                            if (message.playerId === this.localPlayer.id) {
                                // Update both the local player's health and the health bar
                                this.localPlayer.health = message.health;
                                this.updateHealthBar(message.health);
                                
                                // Show hit feedback if damaged
                                if (message.damage > 0) {
                                    this.showHitFeedback(message.damage);
                                }
                                
                                // Also update the main UI health display
                                if (typeof updateHealthUI === 'function') {
                                    updateHealthUI(this.localPlayer);
                                }
                                
                                console.log(`[QuickDraw] Health updated: ${message.health}`);
                                
                                // If player health is 0, play death animation for local player
                                if (message.health <= 0) {
                                    // Make sure we have a local player model for death animation
                                    if (!this.localPlayerModel) {
                                        this.createLocalPlayerModel();
                                    }
                                    
                                    // Ensure local player model is visible in aerial view
                                    if (this.localPlayerModel) {
                                        this.setupAndEnableAerialCamera();
                                        this.localPlayerModel.group.visible = true;
                                        
                                        // Play the death animation
                                        if (this.localPlayerModel.playDeathAnimation) {
                                            console.log('[QuickDraw] Playing death animation for local player');
                                            const deathResult = this.localPlayerModel.playDeathAnimation();
                                            
                                            // Disable player controls during death animation
                                            if (this.localPlayer) {
                                                this.localPlayer.canMove = false;
                                                this.localPlayer.canAim = false;
                                                this.localPlayer.forceLockMovement = true;
                                            }
                                        }
                                    }
                                }
                            }
                            // Update opponent's health if needed (could be extended for UI)
                            else if (message.playerId === this.duelOpponentId) {
                                // Could update opponent health bar if we had one
                                console.log(`[QuickDraw] Opponent health updated: ${message.health}`);
                                
                                // If opponent health is 0, mark them as dying to trigger death animation
                                if (message.health <= 0) {
                                    // Find opponent in the otherPlayers map
                                    const opponentPlayer = this.networkManager.otherPlayers.get(this.duelOpponentId);
                                    if (opponentPlayer) {
                                        // Set the dying flag to trigger death animation
                                        opponentPlayer.isDying = true;
                                        
                                        // Find the remote player model if it exists
                                        if (this.scene.remotePlayerModels) {
                                            const opponentModel = this.scene.remotePlayerModels.get(this.duelOpponentId);
                                            if (opponentModel && opponentModel.playDeathAnimation) {
                                                console.log(`[QuickDraw] Playing death animation for remote player ${this.duelOpponentId}`);
                                                opponentModel.playDeathAnimation();
                                            }
                                        }
                                    }
                                }
                            }
                            
                            // Track this update to prevent duplicates
                            this.healthUpdateTracking.set(updateId, Date.now());
                            
                            // Clean up old health updates (older than 1 second)
                            const now = Date.now();
                            for (const [id, timestamp] of this.healthUpdateTracking.entries()) {
                                if (now - timestamp > 1000) {
                                    this.healthUpdateTracking.delete(id);
                                }
                            }
                        }
                        break;
                }
            } catch (err) {
                console.error('[QuickDraw] Error parsing message:', err);
            }
        };
    }

    /**
     * Updates the list of nearby players for challenge feature
     */
    updateNearbyPlayers() {
        // Skip if in duel or lobby already
        if (this.inDuel || this.inLobby || this.pendingChallenge) return;
        
        const playerPos = this.localPlayer.group.position.clone();
        this.nearbyPlayers.clear();
        this.challengePromptActive = false;
        
        // Check if any other players are within the challenge radius
        if (this.networkManager && this.networkManager.otherPlayers) {
            for (const [playerId, playerData] of this.networkManager.otherPlayers) {
                // Skip NPCs - don't allow dueling with them
                // First make sure playerId is a string before using string methods
                if (playerData.isNpc === true || 
                    (typeof playerId === 'string' && playerId.startsWith('npc_'))) {
                    continue;
                }
                
                // Skip players who are in a quick draw already or don't have position
                if (!playerData.position || playerData.quickDrawLobbyIndex >= 0 || 
                    playerData.inQuickDrawDuel) continue;
                
                // Calculate distance to player
                const otherPos = new THREE.Vector3(
                    playerData.position.x,
                    playerData.position.y,
                    playerData.position.z
                );
                
                const distance = playerPos.distanceTo(otherPos);
                
                // If within challenge radius, add to nearby players
                if (distance <= this.playerProximityRadius) {
                    this.nearbyPlayers.set(playerId, {
                        id: playerId,
                        distance: distance,
                        position: otherPos
                    });
                    
                    this.challengePromptActive = true;
                }
            }
        }
        
        // Update UI based on nearby players
        this.updateChallengeUI();
    }

    /**
     * Updates the UI based on nearby players
     */
    updateChallengeUI() {
        // Skip if in duel, lobby, or if there's a pending challenge
        if (this.inDuel || this.inLobby || this.pendingChallenge) {
            // Hide challenge prompt
            this.challengePrompt.style.display = 'none';
            this.challengeUIVisible = false;
            
            // Also hide invite button on mobile
            if (window.mobileControls && typeof window.mobileControls.checkForNearbyPlayers === 'function') {
                window.mobileControls.checkForNearbyPlayers(false);
            }
            return;
        }
        
        // Update UI based on whether there are nearby players
        if (this.challengePromptActive && !this.challengeUIVisible) {
            this.challengePrompt.style.display = 'flex'; // Use flex instead of block
            this.challengeUIVisible = true;
            
            // Also show invite button on mobile
            if (window.mobileControls && typeof window.mobileControls.checkForNearbyPlayers === 'function') {
                window.mobileControls.checkForNearbyPlayers(true);
            }
        } else if (!this.challengePromptActive && this.challengeUIVisible) {
            this.challengePrompt.style.display = 'none';
            this.challengeUIVisible = false;
            
            // Also hide invite button on mobile
            if (window.mobileControls && typeof window.mobileControls.checkForNearbyPlayers === 'function') {
                window.mobileControls.checkForNearbyPlayers(false);
            }
        }
    }

    /**
     * Send a challenge to the nearest player
     */
    sendChallenge() {
        if (this.nearbyPlayers.size === 0) return;
        
        // Find the nearest player
        let nearestPlayerId = null;
        let nearestDistance = Infinity;
        
        for (const [playerId, data] of this.nearbyPlayers) {
            if (data.distance < nearestDistance) {
                nearestDistance = data.distance;
                nearestPlayerId = playerId;
            }
        }
        
        if (nearestPlayerId) {
            // Check if there's an active outgoing invite to this player
            if (this.outgoingChallenges.has(nearestPlayerId)) {
                console.log(`[QuickDraw] Already sent challenge to player ${nearestPlayerId}, waiting for response`);
                return;
            }
            
            // Check if this player is on cooldown from a previous invite
            if (this.inviteCooldowns.has(nearestPlayerId)) {
                const cooldownEndTime = this.inviteCooldowns.get(nearestPlayerId);
                if (Date.now() < cooldownEndTime) {
                    console.log(`[QuickDraw] This player is on cooldown for ${Math.ceil((cooldownEndTime - Date.now()) / 1000)}s`);
                    return;
                } else {
                    // Cooldown is over, remove it
                    this.inviteCooldowns.delete(nearestPlayerId);
                }
            }
            
            // Hide the challenge prompt
            this.challengePrompt.style.display = 'none';
            this.challengeUIVisible = false;
            
            // Track this outgoing challenge
            this.outgoingChallenges.set(nearestPlayerId, Date.now());
            
            // Send challenge to server
            this.networkManager.sendQuickDrawChallenge(nearestPlayerId);
            
            console.log(`Quick Draw challenge sent to player ${nearestPlayerId}`);
        }
    }

    /**
     * Handle receiving a challenge from another player
     * @param {Object} message - The challenge message
     */
    handleChallengeReceived(message) {
        console.log('[QuickDraw] Challenge received from player', message.challengerId);
        
        if (this.inDuel || this.inLobby) {
            console.log('[QuickDraw] Already in duel or lobby, automatically declining');
            // Automatically decline if already in a duel or lobby
            this.networkManager.sendQuickDrawDecline(message.challengerId);
            return;
        }
        
        // Store the pending challenge
        this.pendingChallenge = {
            challengerId: message.challengerId,
            challengerPosition: message.challengerPosition
        };
        
        // Explicitly hide the "Press E to Duel" challenge prompt
        this.challengePrompt.style.display = 'none';
        this.challengeUIVisible = false;
        
        // Show mobile quick draw invite UI if on mobile
        if (window.mobileControls && typeof window.mobileControls.showQuickdrawInvite === 'function') {
            window.mobileControls.showQuickdrawInvite();
        } else {
            // Show the challenge invitation for desktop
            this.challengeInvitation.style.display = 'block';
        }
        
        // Play notification sound
        if (this.soundManager) {
            this.soundManager.playSound("bellstart");
        }
        
        console.log(`Received Quick Draw challenge from player ${message.challengerId}`);
    }

    /**
     * Accept a pending challenge
     */
    acceptChallenge() {
        if (!this.pendingChallenge) return;
        
        // Hide the invitation
        this.challengeInvitation.style.display = 'none';
        
        // Hide mobile invite buttons if on mobile
        if (window.mobileControls && typeof window.mobileControls.hideQuickdrawInvite === 'function') {
            window.mobileControls.hideQuickdrawInvite();
        }
        
        // Hide the challenge prompt if visible
        this.challengePrompt.style.display = 'none';
        this.challengeUIVisible = false;
        this.challengePromptActive = false;
        
        // Store challenger id before clearing
        const challengerId = this.pendingChallenge.challengerId;
        
        // Send acceptance to server
        this.networkManager.sendQuickDrawAccept(challengerId);
        
        console.log(`Accepted Quick Draw challenge from player ${challengerId}`);
        
        // Log that we're waiting for match details
        console.log('Waiting for server to set up the duel...');
    }

    /**
     * Decline a pending challenge
     */
    declineChallenge() {
        if (!this.pendingChallenge) return;
        
        // Hide the invitation
        this.challengeInvitation.style.display = 'none';
        
        // Hide mobile invite buttons if on mobile
        if (window.mobileControls && typeof window.mobileControls.hideQuickdrawInvite === 'function') {
            window.mobileControls.hideQuickdrawInvite();
        }
        
        // Send decline to server
        this.networkManager.sendQuickDrawDecline(this.pendingChallenge.challengerId);
        
        // Clear the pending challenge
        this.pendingChallenge = null;
    }

    /**
     * Handle challenge accepted by other player
     * @param {Object} message - The acceptance message
     */
    handleChallengeAccepted(message) {
        console.log(`Player ${message.targetId} accepted your Quick Draw challenge`);
        
        // Remove from outgoing challenges
        this.outgoingChallenges.delete(message.targetId);
        
        // Add a cooldown of 3 seconds after accepting
        this.inviteCooldowns.set(message.targetId, Date.now() + 3000);
        
        // Wait for server to respond with match details
    }

    /**
     * Handle challenge declined by other player
     * @param {Object} message - The decline message
     */
    handleChallengeDeclined(message) {
        console.log(`Player ${message.targetId} declined your Quick Draw challenge`);
        
        // Remove from outgoing challenges
        this.outgoingChallenges.delete(message.targetId);
    }

    /**
     * Show the "READY?" message with enhanced typography.
     */
    showReadyMessage() {
        this.duelState = 'ready';
        this.updateStatusIndicator();
        
        // Set a timer to play sound only
        if (this.soundManager) {
            this.soundManager.playSound("bellcountdown", 0.7);
        }
    }

    /**
     * Start the countdown phase of the duel.
     */
    startDuelCountdown() {
        this.duelState = 'countdown';
        this.updateStatusIndicator();
        this.hideMessage();
        
        // Explicitly disable aiming during countdown
        this.localPlayer.canAim = false;
        
        // Hide all player nametags during the duel
        this.hidePlayerNametags();
        
        // Only set up aerial camera if it's not already active
        // This prevents the camera path from changing after the match starts
        if (!this.aerialCameraActive) {
            // Create and switch to aerial camera 
            this.setupAndEnableAerialCamera();
        }
        
        console.log('Duel countdown started - waiting for draw signal');
    }

    /**
     * Setup and immediately enable the aerial camera
     */
    setupAndEnableAerialCamera() {
        // Create aerial camera if it doesn't exist
        if (!this.aerialCamera) {
            this.aerialCamera = new THREE.PerspectiveCamera(
                75, 
                window.innerWidth / window.innerHeight,
                0.1,
                1000
            );
            this.scene.add(this.aerialCamera);
        }
        
        // Create local player model if it doesn't exist
        this.setupLocalPlayerModel();
        
        // Save the current camera for later restoration
        if (this.localPlayer && this.localPlayer.camera) {
            this.originalCamera = this.localPlayer.camera;
            
            // Clear any direct override flags
            this._directCameraOverride = false;
        } else {
            console.warn('Cannot save original camera - local player camera not available');
        }
        
        // Set up the flight path for the quickdraw match
        if (window.flyingEagle) {
            // Wait until both players have properly spawned
            // This ensures we get the correct positions after the quickdraw spawn
            setTimeout(() => {
                // Get player positions to determine the center of the duel
                const player1Pos = this.localPlayer.group.position.clone();
                const player2Pos = this.getOpponentPosition();
                let duelCenter;
                
                if (player2Pos) {
                    // Calculate midpoint between players for eagle's circular path center
                    duelCenter = new THREE.Vector3(
                        (player1Pos.x + player2Pos.x) / 2,
                        (player1Pos.y + player2Pos.y) / 2,
                        (player1Pos.z + player2Pos.z) / 2
                    );
                    
                    // Calculate distance between players for flight radius
                    const distanceBetweenPlayers = player1Pos.distanceTo(player2Pos);
                    
                    // Use the new method to set a closer flight path for quickdraw
                    window.flyingEagle.setQuickdrawFlightPath(duelCenter, distanceBetweenPlayers);
                    
                    console.log('Eagle quickdraw flight path set - closer to players for cinematic view');
                    console.log(`Duel center: (${duelCenter.x.toFixed(2)}, ${duelCenter.y.toFixed(2)}, ${duelCenter.z.toFixed(2)})`);
                    console.log(`Player1: (${player1Pos.x.toFixed(2)}, ${player1Pos.y.toFixed(2)}, ${player1Pos.z.toFixed(2)})`);
                    console.log(`Player2: (${player2Pos.x.toFixed(2)}, ${player2Pos.y.toFixed(2)}, ${player2Pos.z.toFixed(2)})`);
                    console.log(`Distance between players: ${distanceBetweenPlayers.toFixed(2)}`);
                    
                    this.aerialCameraPathSet = true;
                } else {
                    console.warn('Cannot find opponent position - using fallback camera position');
                    
                    // Fallback - position camera around local player only
                    duelCenter = player1Pos.clone();
                    
                    // Setup the eagle's circular flight path around the player
                    window.flyingEagle.setQuickdrawFlightPath(duelCenter, 10); // Default small distance for single player
                    
                    console.log('Eagle quickdraw flight path set to fallback position');
                    this.aerialCameraPathSet = true;
                }
            }, 250); // Small delay to ensure players are in position
            
            // Use the aerial camera as the eagle's POV camera
            window.flyingEagle.camera = this.aerialCamera;
            window.flyingEagle.activateAerialCamera();
        }
        
        // DIRECT SWITCH: Set the renderer's camera directly to aerial
        if (window.renderer) {
            window.renderer.camera = this.aerialCamera;
            
            // Also set the instance camera if available
            if (window.renderer.instance) {
                window.renderer.instance.camera = this.aerialCamera;
                
                // Force a render
                window.renderer.instance.render(this.scene, this.aerialCamera);
            }
        }
        
        // Show local player model
        if (this.localPlayerModel && !this.localPlayerModel.loading) {
            this.localPlayerModel.group.visible = true;
        }
        
        this.aerialCameraActive = true;
        
        console.log('Eagle POV aerial camera enabled for duel countdown');
    }

    /**
     * Position the aerial camera to focus on both players
     */
    positionAerialCamera() {
        if (!this.aerialCamera) return;
        
        // Get player positions
        const player1Pos = this.localPlayer.group.position.clone();
        const player2Pos = this.getOpponentPosition();
        
        if (!player2Pos) {
            console.warn('Cannot find opponent position - using fallback camera position');
            
            // Fallback - position camera around local player only
            const cameraX = player1Pos.x + Math.cos(this.aerialCameraAngle) * 10;
            const cameraZ = player1Pos.z + Math.sin(this.aerialCameraAngle) * 10;
            
            this.aerialCamera.position.set(
                cameraX,
                player1Pos.y + 7, // Higher position to see more of the scene
                cameraZ
            );
            
            // Look at the player
            this.aerialCamera.lookAt(player1Pos);
            return;
        }
        
        // Calculate midpoint between players
        const midpoint = new THREE.Vector3(
            (player1Pos.x + player2Pos.x) / 2,
            (player1Pos.y + player2Pos.y) / 2,
            (player1Pos.z + player2Pos.z) / 2
        );
        
        // Calculate distance between players to scale camera positioning
        const distanceBetweenPlayers = player1Pos.distanceTo(player2Pos);
        
        // Set camera height based on distance (more distance = higher camera)
        const cameraHeight = Math.max(5, distanceBetweenPlayers * 0.5);
        
        // Set camera distance from midpoint based on player distance
        const cameraDistance = Math.max(10, distanceBetweenPlayers * 1.2);
        
        // Camera position along the circle
        const cameraX = midpoint.x + Math.cos(this.aerialCameraAngle) * cameraDistance;
        const cameraZ = midpoint.z + Math.sin(this.aerialCameraAngle) * cameraDistance;
        
        // Position camera
        this.aerialCamera.position.set(
            cameraX,
            midpoint.y + cameraHeight,
            cameraZ
        );
        
        // Look at midpoint
        this.aerialCamera.lookAt(midpoint);
        
        // Log camera positioning for debugging
        if (this.aerialCameraActive && Math.random() < 0.01) { // Only log occasionally to avoid spam
            console.log(`Aerial camera: pos(${cameraX.toFixed(1)}, ${(midpoint.y + cameraHeight).toFixed(1)}, ${cameraZ.toFixed(1)}) looking at (${midpoint.x.toFixed(1)}, ${midpoint.y.toFixed(1)}, ${midpoint.z.toFixed(1)})`);
        }
    }

    /**
     * Update aerial camera rotation and positioning
     * @param {number} deltaTime - Time elapsed since last frame
     */
    updateAerialCamera(deltaTime) {
        if (!this.aerialCameraActive || !this.aerialCamera) return;
        
        // We no longer need to position the camera manually
        // since the eagle controls its own path and the camera follows it
        
        // Update local player model if it exists
        if (this.localPlayerModel) {
            this.updateLocalPlayerModel();
            
            // Ensure animations are running on the model
            if (this.localPlayerModel.animationMixer) {
                this.localPlayerModel.animationMixer.update(deltaTime);
            }
        }
    }

    /**
     * Setup the local player model for third-person view
     */
    setupLocalPlayerModel() {
        // If model already exists, make it visible and update it
        if (this.localPlayerModel && !this.localPlayerModel.loading) {
            // Only set visibility if group exists
            if (this.localPlayerModel.group) {
                this.localPlayerModel.group.visible = true;
            } else {
                console.warn('Local player model exists but group is undefined');
            }
            this.updateLocalPlayerModel();
            return;
        }
        
        // Load ThirdPersonModel if not available
        if (!window.ThirdPersonModel) {
            console.log('Loading ThirdPersonModel module...');
            // First set a placeholder to prevent duplicated loading
            this.localPlayerModel = { loading: true };
            
            import('./playerModel.js').then(module => {
                window.ThirdPersonModel = module.ThirdPersonModel;
                this.createLocalPlayerModel();
            }).catch(error => {
                console.error('Failed to load ThirdPersonModel:', error);
                this.localPlayerModel = null;
            });
        } else {
            // Create model immediately if ThirdPersonModel is available
            this.createLocalPlayerModel();
        }
    }

    /**
     * Create the local player model
     */
    createLocalPlayerModel() {
        // Skip if already created or currently loading
        if (this.localPlayerModel && !this.localPlayerModel.loading) return;
        
        if (!window.ThirdPersonModel) {
            console.error('Cannot create player model: ThirdPersonModel not available');
            return;
        }
        
        try {
            console.log('Creating local player model for aerial view');
            
            // Create the model
            this.localPlayerModel = new window.ThirdPersonModel(this.scene, this.localPlayer.id);
            
            // Check if model was created correctly
            if (!this.localPlayerModel || !this.localPlayerModel.group) {
                console.error('Failed to create player model - group not available');
                this.localPlayerModel = null;
                return;
            }
            
            // Enable debug logging for this model
            this.localPlayerModel.debug = true;
            
            // Apply player appearance if available
            if (window.playerIdentity && window.playerIdentity.appearance) {
                const appearance = window.playerIdentity.appearance;
                if (this.localPlayerModel.setSkinTone) {
                    this.localPlayerModel.setSkinTone(appearance.skinTone || '#C68642');
                }
                if (this.localPlayerModel.setClothingColor) {
                    this.localPlayerModel.setClothingColor(appearance.clothingColor || '#8B4513');
                }
            }
            
            // Add missing updateHitZones method if it doesn't exist
            if (!this.localPlayerModel.updateHitZones) {
                console.log('Adding missing updateHitZones method to localPlayerModel');
                this.localPlayerModel.updateHitZones = function() {
                    // If the model has the updateCollisionBox method, use that to update hitboxes
                    if (typeof this.updateCollisionBox === 'function') {
                        this.updateCollisionBox();
                        
                        // Ensure hitZones mapping exists and is properly updated
                        if (!this.hitZones && (this.headHitbox || this.bodyHitbox || this.limbsHitbox)) {
                            this.hitZones = {
                                head: this.headHitbox,
                                body: this.bodyHitbox,
                                legs: this.limbsHitbox
                            };
                            console.log('Created hit zones mapping from hitboxes');
                        }
                    } else if (this.hitZones) {
                        console.log('Model has hit zones - already properly setup');
                    } else {
                        console.log('Model does not have hit zones defined');
                        
                        // Create basic hitboxes if they don't exist
                        if (this.group && !this.hitZones) {
                            // Calculate bounding box from the model
                            const boundingBox = new THREE.Box3().setFromObject(this.group);
                            const size = boundingBox.getSize(new THREE.Vector3());
                            const center = boundingBox.getCenter(new THREE.Vector3());
                            
                            // Create basic hitboxes
                            this.headHitbox = new THREE.Box3(
                                new THREE.Vector3(center.x - size.x/4, center.y + size.y/4, center.z - size.x/4),
                                new THREE.Vector3(center.x + size.x/4, center.y + size.y/2, center.z + size.x/4)
                            );
                            
                            this.bodyHitbox = new THREE.Box3(
                                new THREE.Vector3(center.x - size.x/3, center.y - size.y/4, center.z - size.x/3),
                                new THREE.Vector3(center.x + size.x/3, center.y + size.y/4, center.z + size.x/3)
                            );
                            
                            this.limbsHitbox = new THREE.Box3(
                                new THREE.Vector3(center.x - size.x/3, center.y - size.y/2, center.z - size.x/3),
                                new THREE.Vector3(center.x + size.x/3, center.y - size.y/4, center.z + size.x/3)
                            );
                            
                            // Create hitZones mapping
                            this.hitZones = {
                                head: this.headHitbox,
                                body: this.bodyHitbox,
                                legs: this.limbsHitbox
                            };
                            
                            console.log('Created emergency hit zones for model without proper hitboxes');
                        }
                    }
                };
            }
            
            // Update position and play idle animation
            this.updateLocalPlayerModel(true);
            
            // Force idle animation - We need to initialize the animation properly
            if (this.localPlayerModel.playAnimation) {
                try {
                    // First make sure animations are properly initialized
                    if (this.localPlayerModel.setupAnimations && 
                        (!this.localPlayerModel.animations || Object.keys(this.localPlayerModel.animations).length === 0)) {
                        // Try to force animation setup if animations aren't loaded
                        if (window.preloadedModels && window.preloadedModels.playermodel && 
                            window.preloadedModels.playermodel.animations) {
                            this.localPlayerModel.setupAnimations(window.preloadedModels.playermodel.animations);
                        }
                    }
                    
                    // Play idle animation with immediate transition
                    this.localPlayerModel.playAnimation('idle', 0);
                    
                    // Explicitly set walking/running flags to ensure proper state
                    this.localPlayerModel.isWalking = false;
                    this.localPlayerModel.isRunning = false;
                    
                    console.log('Playing idle animation on local player model');
                } catch (animError) {
                    console.error('Error playing idle animation:', animError);
                }
            } else {
                console.warn('No playAnimation method available on player model');
            }
            
            // Make sure the model is added to the scene
            if (!this.scene.children.includes(this.localPlayerModel.group)) {
                console.log('Adding player model to scene');
                this.scene.add(this.localPlayerModel.group);
            }
            
            // Show immediately if aerial camera is active
            this.localPlayerModel.group.visible = this.aerialCameraActive;
            
            console.log('Local player model created successfully');
        } catch (error) {
            console.error('Error creating local player model:', error);
            
            // Create a minimal placeholder model to prevent further errors
            this.localPlayerModel = { 
                loading: false,
                group: new THREE.Group(),
                updateHitZones: function() {},
                playAnimation: function() {},
                hitZones: {}
            };
            
            // Add the minimal group to the scene
            this.scene.add(this.localPlayerModel.group);
            
            console.log('Created minimal placeholder model to prevent further errors');
        }
    }

    /**
     * Update local player model position to match the player's camera position.
     * @param {boolean} forceLog - Whether to force logging regardless of state changes.
     */
    updateLocalPlayerModel(forceLog = false) {
        if (!this.localPlayerModel || this.localPlayerModel.loading) return;
        
        // Get the player's current camera position
        const cameraPosition = this.localPlayer.group.position;
        
        // Position calculations
        const lastPosition = this.localPlayerModel.group ? 
            this.localPlayerModel.group.position.clone() : new THREE.Vector3();
        
        // Create position with the Y-offset correction to ensure feet touch ground
        const correctedPosition = cameraPosition.clone();
        
        // Always use consistent offset of 2.72 for proper ground alignment
        correctedPosition.y -= 2.72;
        
        if (this.debug && this.inDuel) {
            console.log(`[QuickDraw DEBUG] Positioning player model: camera at ${cameraPosition.y.toFixed(2)}, feet at ${correctedPosition.y.toFixed(2)}`);
        }
        
        if (this.localPlayerModel.group) {
            this.localPlayerModel.group.position.copy(correctedPosition);
            
            // Copy the player's rotation to the model
            this.localPlayerModel.group.rotation.y = this.localPlayer.group.rotation.y;
            
            // Determine if position has changed significantly to log
            const positionChanged = lastPosition.distanceTo(this.localPlayerModel.group.position) > 0.01;
            
            // Log player model position updates when debugging or forced
            if ((positionChanged || forceLog) && this.debug) {
                console.log(`[QuickDraw] Updated local player model position: 
                    Camera: (${cameraPosition.x.toFixed(2)}, ${cameraPosition.y.toFixed(2)}, ${cameraPosition.z.toFixed(2)})
                    Model: (${this.localPlayerModel.group.position.x.toFixed(2)}, ${this.localPlayerModel.group.position.y.toFixed(2)}, ${this.localPlayerModel.group.position.z.toFixed(2)})
                    On Ground: y=${correctedPosition.y.toFixed(2)}`);
            }
            
            // Only update hit zones if position changed or explicitly forced
            // This avoids unnecessary updates during quickdraw when player can't move
            if ((positionChanged || forceLog) && typeof this.localPlayerModel.updateHitZones === 'function') {
                this.localPlayerModel.updateHitZones();
            }
        } else {
            console.warn('Cannot update local player model - group not initialized');
        }
    }

    /**
     * Get the position of the opponent in the duel
     * @returns {THREE.Vector3|null} - The opponent's position or null if not found
     */
    getOpponentPosition() {
        if (!this.duelOpponentId) return null;
        
        // First try window.otherPlayers (from main.js)
        if (window.otherPlayers && window.otherPlayers.has(this.duelOpponentId)) {
            const opponent = window.otherPlayers.get(this.duelOpponentId);
            if (opponent && opponent.group) {
                return opponent.group.position.clone();
            }
        }
        
        // Fallback to networkManager.otherPlayers
        if (this.networkManager && this.networkManager.otherPlayers) {
            const opponentData = this.networkManager.otherPlayers.get(this.duelOpponentId);
            if (opponentData && opponentData.position) {
                return new THREE.Vector3(
                    opponentData.position.x,
                    opponentData.position.y,
                    opponentData.position.z
                );
            }
        }
        
        return null;
    }

    /**
     * Handle the Draw signal from server
     */
    triggerDraw() {
        this.duelState = 'draw';
        
        // Hide all nametags again to ensure they're hidden during the crucial draw moment
        this.hidePlayerNametags();
        
        // Show the special DRAW message
        this.showMessage("DRAW!", 1000, '#FF0000');
        
        // Show visual draw indicator
        this.drawCircle.style.display = 'block';
        this.drawCircle.style.opacity = '1';
        this.drawCircle.style.transform = 'translate(-50%, -50%) scale(1)';
        
        // Add slow-mo effect if enabled
        if (window.renderer && window.renderer.setTimeScale) {
            window.renderer.setTimeScale(0.5); // Slow to half-speed
            
            // Reset time scale after 1s
            setTimeout(() => {
                if (window.renderer && window.renderer.setTimeScale) {
                    window.renderer.setTimeScale(1.0);
                }
            }, 1000);
        }
        
        // Enable aiming immediately on DRAW
        this.localPlayer.canAim = true;
        
        // Visual feedback 
        setTimeout(() => {
            if (this.drawCircle.style.display !== 'none') {
                this.drawCircle.style.opacity = '0';
                this.drawCircle.style.transform = 'translate(-50%, -50%) scale(1.5)';
                
                // Hide the circle after animation completes
                setTimeout(() => {
                    this.drawCircle.style.display = 'none';
                }, 500);
            }
        }, 500);
        
        // Play draw sound with intensity
        if (this.soundManager) {
            this.soundManager.playSound("draw", 0.8);
        }
        
        // Update UI
        this.updateStatusIndicator();
    }

    /**
     * Handle the countdown message from server - preparation phase  
     * @param {Object} message - Countdown message data
     */
    handleCountdown(message) {
        console.log('[QuickDraw] Received countdown message');
        this.startDuelCountdown();
        
        // Ensure nametags are hidden
        this.hidePlayerNametags();
    }
    
    /**
     * Handle match found message for a queue match
     * @param {Object} message - Match data
     */
    handleMatchFound(message) {
        if (!this.localPlayer) return;
        
        console.log('[QuickDraw] Match found:', message);
        
        // Extract match details
        this.inDuel = true;
        this.duelOpponentId = message.opponentId;
        this.duelActive = true;
        
        // Update aerial camera state
        this.aerialCameraActive = false;
        this.aerialCameraPathSet = false;
        
        // Set internal state to override camera
        this._directCameraOverride = false;
        
        // Update lobby status
        this.inLobby = false;
        
        // Show the message
        this.showReadyMessage();
        
        // Disable player movement and aiming during the duel
        this.localPlayer.canAim = false;
        this.localPlayer.canMove = false;
        
        // Hide nametags for dueling players
        this.hidePlayerNametags();
        
        // Force-lock player movement to prevent any accidental movement
        if (message.movementLocked === true) {
            // Completely block any movement input
            this.localPlayer.forceLockMovement = true;
            
            // Backup original move method and replace with empty function
            if (!this.localPlayer._origMove) {
                this.localPlayer._origMove = this.localPlayer.move;
                this.localPlayer.move = () => {}; // No-op function
            }
        }
        
        // FIXED ISSUE: Teleport player to the spawn position if provided by server
        if (message.startPosition) {
            // Teleport player to the provided position
            console.log(`[QuickDraw] Teleporting player to spawn position:`, message.startPosition);
            this.localPlayer.group.position.set(
                message.startPosition.x,
                message.startPosition.y,
                message.startPosition.z
            );
            
            // Reset velocity to zero
            this.localPlayer.velocity = new THREE.Vector3(0, 0, 0);
            
            // Also set rotation if provided
            if (message.startRotation !== undefined) {
                console.log(`[QuickDraw] Setting player rotation to: ${message.startRotation}`);
                this.localPlayer.group.rotation.y = message.startRotation;
                
                // Debug visualization of player direction
                if (this.debug) {
                    this.showFacingDirection(this.localPlayer.group.position.clone(), message.startRotation);
                }
            }
        } else {
            console.warn('[QuickDraw] No spawn position provided by server');
        }
        
        // Update the main UI health display too
        if (typeof updateHealthUI === 'function') {
            updateHealthUI(this.localPlayer);
        }
        
        // Update status indicator
        this.updateStatusIndicator();
        
        // Mark as ready after showing message
        this.createDuelTimeout(() => {
            console.log('[QuickDraw] Sending ready signal to server');
            this.networkManager.sendQuickDrawReady();
        }, 2000);
    }
    
    /**
     * Reset player state and respawn after a duel
     * @param {Object} message - Reset data
     */
    resetPlayerAndRespawn(message) {
        console.log('[QuickDraw] Received reset and respawn request');
        
        // Restore nametags before resetting state
        this.restorePlayerNametags();
        
        // Reset player state completely
        this.resetPlayerState();
        
        // Apply any health update from message
        if (message && message.health !== undefined) {
            this.localPlayer.health = message.health;
            
            // Update health UI
            if (typeof updateHealthUI === 'function') {
                updateHealthUI(this.localPlayer);
            }
        }
        
        // Reset camera (important even if no aerial view was used)
        this.disableAerialCamera();
        
        // Respawn player at a random town position 
        this.respawnPlayerInTown();
        
        // Send a state reset message to other clients
        this.sendPlayerStateReset();
        
        // Clear all duel timers
        this.clearAllDuelTimers();
    }

    /**
     * Handle the result of the duel (win/loss)
     * @param {Object} message - Result data
     */
    handleResult(message) {
        console.log('[QuickDraw] Received duel result:', message);
        
        // Show appropriate victory/defeat animation
        this.endDuel(message.winnerId);
        
        // Update internal state
        this.inDuel = false;
        this.duelState = 'none';
        
        // Restore nametags but after a delay to match the victory/defeat animation timing
        setTimeout(() => {
            this.restorePlayerNametags();
        }, 1000);
    }

    /**
     * Handle player death in duel
     * @param {Object} message - Death data
     */
    handleDeath(message) {
        console.log(`You were killed by player ${message.killerId}`);
        
        // Set death/kill animation flag to prevent camera switching
        this.inDeathOrKillAnimation = true;
        
        // Skip showing "YOU DIED" message if this is a duel death (we'll show DEFEAT instead)
        if (!this.inDuel) {
            // Show death message only for non-duel deaths
            this.showMessage('YOU DIED', 1500, '#FF0000');
        }
        
        // Play death sound
        if (this.soundManager) {
            this.soundManager.playSound("death", 0.7);
        }
        
        // Create death effect
        this.createDeathEffect();
        
        // Store original mouse handler for later restoration
        const origMouseMove = document.onmousemove;
        
        // Make sure we have a local player model for the death animation
        if (!this.localPlayerModel) {
            this.createLocalPlayerModel();
        }
        
        // Apply death camera effect ALWAYS, regardless of duel status
        if (this.localPlayer && this.localPlayer.camera) {
            // Save original camera rotation
            const originalRotation = this.localPlayer.camera.rotation.clone();
            
            // Apply death camera rotation - rotate camera to look down at the ground
            // Start a smooth rotation animation from current position to looking down
            const deathCameraDuration = 1000; // 1 second for the rotation animation
            const startTime = Date.now();
            const targetRotationX = Math.PI / 2; // Looking down at the ground (90 degrees)
            
            // Create an animation function that rotates the camera over time
            const rotateCameraUp = () => {
                const elapsed = Date.now() - startTime;
                const progress = Math.min(elapsed / deathCameraDuration, 1);
                
                // Use an easing function (ease-out) for smoother animation
                const easeOut = 1 - Math.pow(1 - progress, 2);
                
                // Interpolate between original and target rotation
                this.localPlayer.camera.rotation.x = originalRotation.x * (1 - easeOut) + targetRotationX * easeOut;
                
                // Continue the animation until complete
                if (progress < 1) {
                    requestAnimationFrame(rotateCameraUp);
                }
            };
            
            // Start the camera rotation animation
            rotateCameraUp();
            
            // Disable mouse look temporarily
            document.onmousemove = (e) => {
                // Block mouse movement during death animation
                e.stopPropagation();
                return false;
            };
        }
        
        // Keep the player's POV camera active during death
        if (this.localPlayerModel) {
            // Force the local player's camera to be active
            if (window.renderer) {
                window.renderer.camera = this.localPlayer.camera;
                
                // Also set the instance camera if available
                if (window.renderer.instance) {
                    window.renderer.instance.camera = this.localPlayer.camera;
                }
            }
            
            // Make the model visible for other players but not in our own view
            this.localPlayerModel.group.visible = true;
            
            // Play the death animation
            if (this.localPlayerModel.playDeathAnimation) {
                console.log('[QuickDraw] Playing death animation');
                const deathResult = this.localPlayerModel.playDeathAnimation();
                
                // Play the player fall sound when death animation starts
                if (this.soundManager) {
                    this.soundManager.playSound("playerfall", 0, 0.8);
                }
                
                // Allow the death animation to complete before reset/respawn
                const deathAnimDuration = deathResult.duration || 1500;
                
                // Disable player controls during death animation
                if (this.localPlayer) {
                    this.localPlayer.canMove = false;
                    this.localPlayer.canAim = false;
                    this.localPlayer.forceLockMovement = true;
                }
                
                // Wait for animation to complete before server sends respawn
                console.log(`[QuickDraw] Death animation playing, duration: ${deathAnimDuration}ms`);
                
                // Clear animation flag after animation completes
                setTimeout(() => {
                    this.inDeathOrKillAnimation = false;
                    
                    // Restore original mouse movement
                    document.onmousemove = origMouseMove;
                }, deathAnimDuration + 500); // Add a bit of buffer
                
                // The server will send fullStateReset message after the animation duration
                // We're ensuring the animation has time to play fully
                
                // Broadcast our death animation state to other players
                if (this.networkManager && this.networkManager.socket) {
                    this.networkManager.socket.send(JSON.stringify({
                        type: 'playerUpdate',
                        isDying: true,  // Special flag to trigger death animation on other clients
                        health: 0,
                        position: this.localPlayer.group.position,
                        rotation: { y: this.localPlayer.group.rotation.y }
                    }));
                    console.log('[QuickDraw] Broadcast death animation state to other players');
                }
            } else {
                console.warn('[QuickDraw] Death animation not available on player model');
                
                // Clear animation flag after a default delay if no animation
                setTimeout(() => {
                    this.inDeathOrKillAnimation = false;
                    
                    // Restore original mouse movement
                    document.onmousemove = origMouseMove;
                }, 3000);
            }
        } else {
            console.warn('[QuickDraw] Could not create local player model for death animation');
            
            // Clear animation flag after a default delay if no model
            setTimeout(() => {
                this.inDeathOrKillAnimation = false;
                
                // Restore original mouse movement
                document.onmousemove = origMouseMove;
            }, 3000);
        }
    }
    
    /**
     * Handle player kill in duel
     * @param {Object} message - Kill data
     */
    handleKill(message) {
        console.log('[QuickDraw] Player got a kill in duel', message);
        
        // Create kill effect 
        this.createKillEffect();
        
        // Add a hit marker
        this.showHitMarker(message.hitZone || 'body');
        
        // Restore nametags
        this.restorePlayerNametags();
        
        // The result screen will appear shortly
    }

    /**
     * Checks the Quick Draw state and updates game elements accordingly
     * @param {number} deltaTime - Time elapsed since last frame
     */
    update(deltaTime) {
        // Skip if player not initialized
        if (!this.localPlayer || !this.localPlayer.group) return;
        
        // CRITICAL: Emergency camera switch enforcement
        if (this.duelState === 'draw') {
            // If we're in draw phase, FORCE the local camera always
            if (window.renderer && window.renderer.instance) {
                if (this.localPlayer && this.localPlayer.camera) {
                    // Direct override if not already applied
                    if (!this._directCameraOverride) {
                        console.log('EMERGENCY CAMERA RESET in update loop - forcing player camera');
                        window.renderer.instance.camera = this.localPlayer.camera;
                        window.renderer.camera = this.localPlayer.camera;
                        this._directCameraOverride = true;
                    }
                    
                    // Double-check that camera is still correctly set
                    if (window.renderer.instance.camera !== this.localPlayer.camera) {
                        console.warn('CRITICAL: Camera was changed outside our control - RE-FORCING player camera');
                        window.renderer.instance.camera = this.localPlayer.camera;
                        window.renderer.camera = this.localPlayer.camera;
                    }
                }
            }
            
            // Make sure aerial camera is disabled
            this.aerialCameraActive = false;
            
            // Ensure local player model is hidden
            if (this.localPlayerModel && !this.localPlayerModel.loading && this.localPlayerModel.group) {
                this.localPlayerModel.group.visible = false;
            }
            
            // If we're in duel mode, periodically check and fix hit zones
            if (this.inDuel && Math.random() < 0.01) { // Check occasionally 
                this.fixHitZonesForQuickDraw();
            }
        } 
        else if ((this.duelState === 'ready' || this.duelState === 'countdown' || this.duelState === 'none') && 
                 this.inDuel && !this.aerialCameraActive && !this.inDeathOrKillAnimation) {
            // Only enable aerial camera if we're not in death/kill animation
            console.log('Aerial camera not active during pre-draw phase - enabling');
            this.setupAndEnableAerialCamera();
        }
        
        // Update flying eagle if it exists
        if (window.flyingEagle && (this.aerialCameraActive || this.duelState === 'draw')) {
            window.flyingEagle.update(deltaTime);
        }
        
        // Update aerial camera if active and not in death/kill animation
        if (this.aerialCameraActive && !this.inDeathOrKillAnimation) {
            this.updateAerialCamera(deltaTime);
        }
        
        // If in death/kill animation, ensure player camera is active
        if (this.inDeathOrKillAnimation && this.localPlayer && this.localPlayer.camera) {
            if (window.renderer) {
                if (window.renderer.camera !== this.localPlayer.camera) {
                    console.log('Forcing player camera during death/kill animation');
                    window.renderer.camera = this.localPlayer.camera;
                    
                    // Also set the instance camera if available
                    if (window.renderer.instance && window.renderer.instance.camera !== this.localPlayer.camera) {
                        window.renderer.instance.camera = this.localPlayer.camera;
                    }
                }
            }
        }
        
        // Update nearby players for challenges
        this.updateNearbyPlayers();
        
        // Update status indicator
        this.updateStatusIndicator();
        
        // If penalized, keep gun locked until penalty expires
        if (this.penaltyEndTime > 0) {
            if (Date.now() < this.penaltyEndTime) {
                // Keep gun locked
                this.localPlayer.canAim = false;
            } else {
                // Penalty expired, unlock gun if in draw phase
                if (this.duelState === 'draw') {
                    this.localPlayer.canAim = true;
                }
                
                // Clear penalty
                this.penaltyEndTime = 0;
            }
        }
        
        // Check for early draw (using mouse down) during countdown
        if (this.duelState === 'countdown' && !this.penaltyEndTime) {
            if ((window.mouseDown && (window.mouseDown.left || window.mouseDown.right)) || this.localPlayer.isAiming) {
                this.penalizeEarlyDraw();
            }
        }
    }

    /**
     * Updates the Quick Draw status indicator.
     */
    updateStatusIndicator() {
        if (!this.statusIndicator) return;
        
        // Show/hide based on duel state
        if (this.inDuel || this.inLobby) {
            this.statusIndicator.style.display = 'block';
            let statusText = '';
            
            if (this.inLobby) {
                statusText = 'Quick Draw: Waiting for players...';
            } else if (this.inDuel) {
                switch (this.duelState) {
                    case 'ready':
                        statusText = 'Quick Draw: Get ready!';
                        break;
                    case 'countdown':
                        statusText = 'Quick Draw: Wait for the signal!';
                        break;
                    case 'draw':
                        statusText = 'Quick Draw: DRAW!';
                        break;
                    default:
                        statusText = 'Quick Draw: Duel in progress';
                }
            }
            
            this.statusIndicator.textContent = statusText;
        } else {
            this.statusIndicator.style.display = 'none';
        }
    }

    /**
     * Handle match found notification from server.
     */
    handleMatchFound(message) {
        console.log('[QuickDraw] Match found handler executed', message);
        
        // Validate required fields
        if (!message.opponentId) {
            console.error('[QuickDraw] Missing opponent ID in match found message:', message);
            return;
        }
        
        // First, make sure any previous aerial camera is disabled
        this.disableAerialCamera();
        
        // Clear any existing timers from previous matches
        this.clearAllDuelTimers();
        
        this.inDuel = true;
        this.inLobby = false;
        this.duelOpponentId = message.opponentId;
        this.duelState = 'none';
        this.pendingChallenge = null;
        
        console.log(`[QuickDraw] Starting duel with opponent ${this.duelOpponentId}`);
        
        // Play dramatic music for the duel start
        if (this.soundManager) {
            this.soundManager.playSound("dramatic", 0, 0.7); // Play at 70% volume
        }
        
        // Store original player movement and aiming states
        this.originalCanAim = this.localPlayer.canAim;
        this.originalCanMove = this.localPlayer.canMove;
        
        // Store original position to return after the duel
        this.originalPosition = {
            x: this.localPlayer.group.position.x,
            y: this.localPlayer.group.position.y,
            z: this.localPlayer.group.position.z
        };
        this.originalRotation = this.localPlayer.group.rotation.y;
        
        // Disable player movement and aiming during the duel
        this.localPlayer.canAim = false;
        this.localPlayer.canMove = false;
        
        // Hide nametags for dueling players
        this.hidePlayerNametags();
        
        // Force-lock player movement to prevent any accidental movement
        if (message.movementLocked === true) {
            // Completely block any movement input
            this.localPlayer.forceLockMovement = true;
            
            // Backup original move method and replace with empty function
            if (!this.localPlayer._origMove) {
                this.localPlayer._origMove = this.localPlayer.move;
                this.localPlayer.move = () => {}; // No-op function
            }
        }
        
        // FIXED ISSUE: Teleport player to the spawn position if provided by server
        if (message.startPosition) {
            // Teleport player to the provided position
            console.log(`[QuickDraw] Teleporting player to spawn position:`, message.startPosition);
            this.localPlayer.group.position.set(
                message.startPosition.x,
                message.startPosition.y,
                message.startPosition.z
            );
            
            // Reset velocity to zero
            this.localPlayer.velocity = new THREE.Vector3(0, 0, 0);
            
            // Also set rotation if provided
            if (message.startRotation !== undefined) {
                console.log(`[QuickDraw] Setting player rotation to: ${message.startRotation}`);
                this.localPlayer.group.rotation.y = message.startRotation;
                
                // Debug visualization of player direction
                if (this.debug) {
                    this.showFacingDirection(this.localPlayer.group.position.clone(), message.startRotation);
                }
            }
        } else {
            console.warn('[QuickDraw] No spawn position provided by server');
        }
        
        // Update the main UI health display too
        if (typeof updateHealthUI === 'function') {
            updateHealthUI(this.localPlayer);
        }
        
        // Update status indicator
        this.updateStatusIndicator();
        
        // Mark as ready after showing message
        this.createDuelTimeout(() => {
            console.log('[QuickDraw] Sending ready signal to server');
            this.networkManager.sendQuickDrawReady();
        }, 2000);
    }
    
    /**
     * Hide all player nametags during a duel, not just the participants
     * @param {number} player1Id - First player's ID (local player)
     * @param {number} player2Id - Second player's ID (opponent)
     */
    hidePlayerNametags() {
        // Check if we have access to the multiplayerManager
        if (!window.multiplayerManager) {
            console.warn('[QuickDraw] Cannot hide nametags - multiplayerManager not available');
            return;
        }
        
        console.log(`[QuickDraw] Hiding all nametags during quickdraw duel`);
        
        // Store original display state for all player labels
        this.originalLabelDisplays = new Map();
        
        // Hide all player labels
        window.multiplayerManager.playerLabels.forEach((labelData, playerId) => {
            if (labelData && labelData.div) {
                this.originalLabelDisplays.set(playerId, labelData.div.style.display);
                labelData.div.style.display = 'none';
            }
        });
    }
    
    /**
     * Restore all hidden nametags after duel
     */
    restorePlayerNametags() {
        // Check if we have access to the multiplayerManager
        if (!window.multiplayerManager) return;
        
        console.log('[QuickDraw] Restoring all player nametags after duel');
        
        // Restore all player labels to their original display state
        if (this.originalLabelDisplays && this.originalLabelDisplays.size > 0) {
            window.multiplayerManager.playerLabels.forEach((labelData, playerId) => {
                if (labelData && labelData.div) {
                    const originalDisplay = this.originalLabelDisplays.get(playerId) || 'block';
                    labelData.div.style.display = originalDisplay;
                }
            });
            
            // Clear stored display states
            this.originalLabelDisplays.clear();
        } else {
            // Fallback - make all labels visible
            window.multiplayerManager.playerLabels.forEach((labelData, playerId) => {
                if (labelData && labelData.div) {
                    labelData.div.style.display = 'block';
                }
            });
        }
    }
    
    /**
     * Show a temporary arrow indicating which way the player is facing
     * @param {Object} position - The player position
     * @param {number} rotation - The player rotation in radians
     */
    showFacingDirection(position, rotation) {
        // Create a group to hold all debug objects
        const debugGroup = new THREE.Group();
        
        // Create direction arrow with more visibility
        const arrowLength = 8; // Longer arrow
        const arrowGeometry = new THREE.ConeGeometry(0.5, arrowLength, 8);
        const arrowMaterial = new THREE.MeshBasicMaterial({ 
            color: 0x00FF00,
            transparent: true,
            opacity: 0.8
        });
        const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
        
        // Position the arrow at player position, slightly above ground
        arrow.position.set(0, 2, 0); // Local position within group
        
        // Rotate arrow to match player rotation
        // By default, the cone points up along Y axis, so we need to rotate it to point along Z axis first
        arrow.rotation.x = Math.PI / 2;
        
        // Add line showing forward direction
        const lineMaterial = new THREE.LineBasicMaterial({
            color: 0xFFFF00,
            linewidth: 3
        });
        const linePoints = [];
        linePoints.push(new THREE.Vector3(0, 0.5, 0));
        linePoints.push(new THREE.Vector3(0, 0.5, arrowLength * 1.2)); // Slightly longer than arrow
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints);
        const line = new THREE.Line(lineGeometry, lineMaterial);
        
        // Create text label showing rotation angle
        const textCanvas = document.createElement('canvas');
        textCanvas.width = 256;
        textCanvas.height = 128;
        const context = textCanvas.getContext('2d');
        context.fillStyle = 'rgba(0, 0, 0, 0.7)';
        context.fillRect(0, 0, textCanvas.width, textCanvas.height);
        context.font = 'bold 24px Arial';
        context.fillStyle = 'white';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        
        // Calculate angle in degrees for display
        const angleDegrees = (rotation * 180 / Math.PI).toFixed(1);
        context.fillText(`Rotation: ${angleDegrees}°`, textCanvas.width / 2, textCanvas.height / 2);
        
        const texture = new THREE.CanvasTexture(textCanvas);
        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(5, 2.5, 1);
        sprite.position.set(0, 4, 0); // Position above arrow
        
        // Add all elements to the debug group
        debugGroup.add(arrow);
        debugGroup.add(line);
        debugGroup.add(sprite);
        
        // Position and rotate the entire group
        debugGroup.position.copy(position);
        debugGroup.rotation.y = rotation;
        
        // Add to scene
        this.scene.add(debugGroup);
        
        // Add temporary sphere at player position as reference
        const sphereGeometry = new THREE.SphereGeometry(0.5, 16, 16);
        const sphereMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xFF0000,
            transparent: true,
            opacity: 0.6
        });
        const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
        sphere.position.set(position.x, position.y + 0.5, position.z);
        this.scene.add(sphere);
        
        // Create a label for "Player Position"
        const posCanvas = document.createElement('canvas');
        posCanvas.width = 256;
        posCanvas.height = 64;
        const posContext = posCanvas.getContext('2d');
        posContext.fillStyle = 'rgba(0, 0, 0, 0.7)';
        posContext.fillRect(0, 0, posCanvas.width, posCanvas.height);
        posContext.font = 'bold 20px Arial';
        posContext.fillStyle = 'white';
        posContext.textAlign = 'center';
        posContext.textBaseline = 'middle';
        posContext.fillText('Player Position', posCanvas.width / 2, posCanvas.height / 2);
        
        const posTexture = new THREE.CanvasTexture(posCanvas);
        const posMaterial = new THREE.SpriteMaterial({
            map: posTexture,
            transparent: true
        });
        const posSprite = new THREE.Sprite(posMaterial);
        posSprite.scale.set(4, 1, 1);
        posSprite.position.set(position.x, position.y + 1.5, position.z);
        this.scene.add(posSprite);
        
        console.log(`Debug direction arrow created at (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}) with rotation ${rotation.toFixed(4)} rad (${angleDegrees}°)`);
        
        // Remove after 5 seconds
        setTimeout(() => {
            this.scene.remove(debugGroup);
            this.scene.remove(sphere);
            this.scene.remove(posSprite);
        }, 5000);
    }
    
    /**
     * Updates the health bar with the current health value
     * @param {number} health - Health value (0-100)
     */
    updateHealthBar(health) {
        // Ensure health is within valid range
        health = Math.max(0, Math.min(100, health));
        
        // Update health bar width
        this.healthBar.style.width = `${health}%`;
        
        // Update color based on health amount
        if (health > 60) {
            this.healthBar.style.backgroundColor = '#00FF00'; // Green
        } else if (health > 30) {
            this.healthBar.style.backgroundColor = '#FFA500'; // Orange
        } else {
            this.healthBar.style.backgroundColor = '#FF0000'; // Red
        }
        
        // Update text
        this.healthText.textContent = `${health} HP`;
    }

    /**
     * Apply a penalty with dramatic red flashing warning.
     * Once triggered, records a penalty end time so that gun drawing remains locked
     * for a full 3 seconds even if the "DRAW!" signal comes.
     */
    penalizeEarlyDraw() {
        // Lock gun for 3 seconds
        this.penaltyEndTime = Date.now() + 3000;
        this.localPlayer.canAim = false;
        
        // Force holster any weapon that might be drawn
        if (this.localPlayer.isAiming) {
            this.localPlayer.isAiming = false;
            
            // Play the holstering animation
            if (this.localPlayer.viewmodel) {
                this.localPlayer.viewmodel.playHolsterAnim();
                
                // Hide viewmodel after holster animation completes
                setTimeout(() => {
                    if (this.localPlayer.viewmodel) {
                        this.localPlayer.viewmodel.group.visible = false;
                    }
                }, 500);
            }
        }
        
        // Show the penalty message
        this.showMessage('TOO EARLY! Penalty!', 2000);
        
        // Create a flashing red overlay for penalty
        const penaltyOverlay = document.createElement('div');
        penaltyOverlay.style.position = 'absolute';
        penaltyOverlay.style.top = '0';
        penaltyOverlay.style.left = '0';
        penaltyOverlay.style.width = '100%';
        penaltyOverlay.style.height = '100%';
        penaltyOverlay.style.backgroundColor = 'rgba(255, 0, 0, 0.3)';
        penaltyOverlay.style.zIndex = '999';
        penaltyOverlay.style.animation = 'penalty-flash 0.5s 3';
        
        // Add animation style
        const style = document.createElement('style');
        style.innerHTML = `
            @keyframes penalty-flash {
                0% { opacity: 0; }
                50% { opacity: 1; }
                100% { opacity: 0; }
            }
        `;
        document.head.appendChild(style);
        
        // Add to game container and remove after penalty
        document.getElementById('game-container').appendChild(penaltyOverlay);
        
        // Play penalty sound
        if (this.soundManager) {
            this.soundManager.playSound("wrong", 0.7);
        }
        
        // Remove overlay after penalty animation
        setTimeout(() => {
            if (penaltyOverlay.parentNode) {
                penaltyOverlay.parentNode.removeChild(penaltyOverlay);
            }
        }, 1500);
        
        // Send penalty to server for validation
        if (this.networkManager && typeof this.networkManager.sendQuickDrawPenalty === 'function') {
            this.networkManager.sendQuickDrawPenalty();
        }
    }

    /**
     * End the duel with enhanced win/lose UI effects.
     */
    endDuel(winnerId) {
        console.log('[QuickDraw] Ending duel, winner:', winnerId);
        
        // Update state first to prevent any update logic from running
        this.duelState = 'none';
        
        // Set flag to prevent switching back to aerial view
        this.inDeathOrKillAnimation = true;
        
        // IMPORTANT: We no longer show aerial camera after death
        // Instead, we keep the player's camera viewpoint
        console.log('[QuickDraw] Keeping player viewpoint for death scene');
        
        // Force player camera to be active
        if (this.localPlayer && this.localPlayer.camera) {
            if (window.renderer) {
                window.renderer.camera = this.localPlayer.camera;
                
                // Also set the instance camera if available
                if (window.renderer.instance) {
                    window.renderer.instance.camera = this.localPlayer.camera;
                }
            }
            
            // Only apply death camera rotation if player lost
            const playerLost = winnerId !== this.localPlayer.id;
            if (playerLost) {
                // Store original mouse handler for later restoration
                const origMouseMove = document.onmousemove;
                
                // Save original camera rotation
                const originalRotation = this.localPlayer.camera.rotation.clone();
                
                // Apply death camera rotation - rotate camera to look down at the ground
                // Start a smooth rotation animation from current position to looking down
                const deathCameraDuration = 1000; // 1 second for the rotation animation
                const startTime = Date.now();
                const targetRotationX = Math.PI / 2; // Looking down at the ground (90 degrees)
                
                // Create an animation function that rotates the camera over time
                const rotateCameraUp = () => {
                    const elapsed = Date.now() - startTime;
                    const progress = Math.min(elapsed / deathCameraDuration, 1);
                    
                    // Use an easing function (ease-out) for smoother animation
                    const easeOut = 1 - Math.pow(1 - progress, 2);
                    
                    // Interpolate between original and target rotation
                    this.localPlayer.camera.rotation.x = originalRotation.x * (1 - easeOut) + targetRotationX * easeOut;
                    
                    // Continue the animation until complete
                    if (progress < 1) {
                        requestAnimationFrame(rotateCameraUp);
                    }
                };
                
                // Start the camera rotation animation
                rotateCameraUp();
                
                // Disable mouse look temporarily
                document.onmousemove = (e) => {
                    // Block mouse movement during death animation
                    e.stopPropagation();
                    return false;
                };
                
                // Restore mouse movement after animation completes
                setTimeout(() => {
                    document.onmousemove = origMouseMove;
                }, 3000);
            }
        }
        
        // Ensure letterbox effect is removed immediately
        document.body.classList.remove('letterbox-active');
        
        // Determine if player won or lost
        const playerWon = winnerId === this.localPlayer.id;
        
        // Tell the renderer not to show kill markers for quickdraw
        if (window.renderer) {
            window.renderer.skipNextKillMarker = true;
        }
        
        // Create overlay and play sounds
        this.showVictoryDefeatOverlay(playerWon);
        
        // Unlock player's original movement methods right away
        // This is crucial - ensure the player isn't locked even if later code fails
        if (this.localPlayer) {
            // Restore original movement methods right away
            if (this.localPlayer._origMove) {
                console.log('[QuickDraw] Restoring original move method immediately');
                this.localPlayer.move = this.localPlayer._origMove;
                this.localPlayer._origMove = null;
            }
            
            // Reset force lock immediately
            this.localPlayer.forceLockMovement = false;
        }
        
        // Clear animation flag after the victory/defeat screen has been shown
        setTimeout(() => {
            this.inDeathOrKillAnimation = false;
            
            // Restore nametags after death animation
            this.restorePlayerNametags();
            
            // Double-check that letterbox effect is removed after animation
            document.body.classList.remove('letterbox-active');
        }, 3000);
        
        // Server will send fullStateReset message after a delay
    }

    /**
     * Show victory/defeat overlay with appropriate effects
     */
    showVictoryDefeatOverlay(playerWon) {
        // Create an auto-fading overlay
        const resultOverlay = document.createElement('div');
        resultOverlay.id = 'quickdraw-result-overlay';
        resultOverlay.className = 'quickdraw-result';
        resultOverlay.style.position = 'fixed';
        resultOverlay.style.top = '0';
        resultOverlay.style.left = '0';
        resultOverlay.style.width = '100%';
        resultOverlay.style.height = '100%';
        resultOverlay.style.display = 'flex';
        resultOverlay.style.flexDirection = 'column';
        resultOverlay.style.alignItems = 'center';
        resultOverlay.style.justifyContent = 'center';
        resultOverlay.style.backgroundColor = playerWon ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.4)';
        resultOverlay.style.zIndex = '9999';
        resultOverlay.style.opacity = '0';
        resultOverlay.style.transition = 'opacity 0.5s ease-in, opacity 1s ease-out 2.5s';
        
        // Create western-style wooden sign background
        const woodenSign = document.createElement('div');
        woodenSign.style.width = '600px';
        woodenSign.style.height = '300px';
        woodenSign.style.background = 'url("/textures/wooden_sign.png") no-repeat center center';
        woodenSign.style.backgroundSize = 'contain';
        woodenSign.style.display = 'flex';
        woodenSign.style.alignItems = 'center';
        woodenSign.style.justifyContent = 'center';
        woodenSign.style.position = 'relative';
        woodenSign.style.transform = 'rotate(-3deg)';
        
        // Create text element inside the wooden sign
        const resultText = document.createElement('div');
        resultText.textContent = playerWon ? 'VICTORY!' : 'DEFEAT';
        resultText.style.fontSize = '80px';
        resultText.style.fontWeight = 'bold';
        resultText.style.fontFamily = 'Western, "Wanted M54", serif';
        resultText.style.color = playerWon ? '#FFD700' : '#FF3333';
        resultText.style.textShadow = playerWon 
            ? '0 0 10px #FF9900, 0 0 20px #FF9900, 2px 2px 2px rgba(0,0,0,0.7)' 
            : '0 0 10px #AA0000, 0 0 20px #AA0000, 2px 2px 2px rgba(0,0,0,0.7)';
        resultText.style.transform = 'translateY(-10px)';
        
        // Create subtitle message
        const subtitleText = document.createElement('div');
        subtitleText.textContent = playerWon ? 'You Won The Duel!' : 'You Lost The Duel!';
        subtitleText.style.fontSize = '24px';
        subtitleText.style.fontFamily = 'Western, "Rye", serif';
        subtitleText.style.color = '#FFF8DC';
        subtitleText.style.marginTop = '10px';
        subtitleText.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
        
        // Add decorative bullet holes to the sign if defeated
        if (!playerWon) {
            for (let i = 0; i < 3; i++) {
                const bulletHole = document.createElement('div');
                bulletHole.style.position = 'absolute';
                bulletHole.style.width = '30px';
                bulletHole.style.height = '30px';
                bulletHole.style.borderRadius = '50%';
                bulletHole.style.backgroundColor = '#000';
                bulletHole.style.boxShadow = 'inset 0 0 10px 5px rgba(30, 30, 30, 0.8)';
                
                // Random positions for bullet holes
                bulletHole.style.top = `${Math.random() * 70 + 15}%`;
                bulletHole.style.left = `${Math.random() * 70 + 15}%`;
                bulletHole.style.transform = 'translate(-50%, -50%)';
                
                woodenSign.appendChild(bulletHole);
            }
        } else {
            // Add decorative sheriff star for victory
            const star = document.createElement('div');
            star.style.position = 'absolute';
            star.style.top = '10%';
            star.style.right = '15%';
            star.style.width = '60px';
            star.style.height = '60px';
            star.style.backgroundImage = 'url("/textures/sheriff_badge.png")';
            star.style.backgroundSize = 'contain';
            star.style.backgroundRepeat = 'no-repeat';
            star.style.filter = 'drop-shadow(0 0 5px gold)';
            
            woodenSign.appendChild(star);
        }
        
        // Add decoration rope to sign
        const rope = document.createElement('div');
        rope.style.position = 'absolute';
        rope.style.top = '-20px';
        rope.style.left = '50%';
        rope.style.width = '8px';
        rope.style.height = '30px';
        rope.style.backgroundColor = '#8B4513';
        rope.style.transform = 'translateX(-50%)';
        
        woodenSign.appendChild(resultText);
        woodenSign.appendChild(subtitleText);
        woodenSign.appendChild(rope);
        resultOverlay.appendChild(woodenSign);
        document.body.appendChild(resultOverlay);
        
        // Fade in and animate
        setTimeout(() => {
            resultOverlay.style.opacity = '1';
            woodenSign.style.transition = 'transform 0.3s ease-in-out';
            woodenSign.style.transform = 'rotate(-3deg) scale(1.1)';
            
            setTimeout(() => {
                woodenSign.style.transform = 'rotate(-3deg) scale(1)';
                // Start subtle swinging animation
                woodenSign.style.animation = 'gentle-swing 2s ease-in-out infinite';
                
                // Add swing animation
                const styleSheet = document.createElement('style');
                styleSheet.id = 'quickdraw-animations';
                styleSheet.textContent = `
                    @keyframes gentle-swing {
                        0% { transform: rotate(-3deg); }
                        50% { transform: rotate(-1deg); }
                        100% { transform: rotate(-3deg); }
                    }
                `;
                document.head.appendChild(styleSheet);
            }, 300);
        }, 100);
        
        // Standard message overlay as backup
        this.messageOverlay.textContent = playerWon ? 'VICTORY!' : 'DEFEAT';
        this.messageOverlay.className = 'quickdraw-result';
        this.messageOverlay.style.display = 'block';
        this.messageOverlay.style.fontSize = '72px';
        this.messageOverlay.style.color = playerWon ? '#FFD700' : '#FF3333';
        this.messageOverlay.style.textShadow = playerWon 
            ? '0 0 20px #FF9900' 
            : '0 0 20px #AA0000';
        
        // Play victory/defeat sound
        if (this.soundManager) {
            this.soundManager.playSound("quickdrawending", 0, 0.8);
        }
        
        // Auto-fade out the overlay faster (after 2 seconds instead of 2.5)
        setTimeout(() => {
            // Apply smoother fade out transition
            resultOverlay.style.transition = 'opacity 0.8s ease-out';
            resultOverlay.style.opacity = '0';
            
            // Remove from DOM after fade out
            setTimeout(() => {
                if (resultOverlay.parentNode) {
                    resultOverlay.parentNode.removeChild(resultOverlay);
                }
                
                // Clean up animation style
                const animStyle = document.getElementById('quickdraw-animations');
                if (animStyle && animStyle.parentNode) {
                    animStyle.parentNode.removeChild(animStyle);
                }
                
                // Hide message overlay too
                this.hideMessage();
            }, 1000);
        }, 2000);
    }
    
    /**
     * Checks if a point is within the active arena.
     * This is a compatibility method for player.js boundary checks.
     * Now that we're using direct challenges on the map, this always returns true.
     * @param {THREE.Vector3} position - The position to check
     * @param {number} arenaIndex - The arena index
     * @returns {boolean} - True, since there are no arena boundaries to enforce
     */
    isPointInArena(position, arenaIndex) {
        // Since we're not using arenas anymore, always return true
        // to prevent boundary collision detection from restricting movement
        return true;
    }

    /**
     * Show feedback when player is hit during a duel
     * @param {number} damage - The amount of damage taken
     */
    showHitFeedback(damage) {
        // Create flash effect for hit feedback
        const hitOverlay = document.createElement('div');
        hitOverlay.style.position = 'absolute';
        hitOverlay.style.top = '0';
        hitOverlay.style.left = '0';
        hitOverlay.style.width = '100%';
        hitOverlay.style.height = '100%';
        hitOverlay.style.backgroundColor = 'rgba(255, 0, 0, 0.3)';
        hitOverlay.style.pointerEvents = 'none';
        hitOverlay.style.zIndex = '999';
        hitOverlay.style.animation = 'hit-flash 0.2s ease-out';
        
        // Add animation style
        const style = document.createElement('style');
        style.innerHTML = `
            @keyframes hit-flash {
                0% { opacity: 0.7; }
                100% { opacity: 0; }
            }
        `;
        document.head.appendChild(style);
        
        // Add to game container
        document.getElementById('game-container').appendChild(hitOverlay);
        
        // Remove overlay after animation
        setTimeout(() => {
            if (hitOverlay.parentNode) {
                hitOverlay.parentNode.removeChild(hitOverlay);
            }
            if (style.parentNode) {
                style.parentNode.removeChild(style);
            }
        }, 200);
        
        // Show damage number
        if (damage > 0) {
            const damageText = document.createElement('div');
            damageText.textContent = `-${damage}`;
            damageText.style.position = 'absolute';
            damageText.style.top = '30%';
            damageText.style.left = '50%';
            damageText.style.transform = 'translate(-50%, -50%)';
            damageText.style.color = '#FF4444';
            damageText.style.fontSize = '32px';
            damageText.style.fontWeight = 'bold';
            damageText.style.textShadow = '2px 2px 4px rgba(0, 0, 0, 0.7)';
            damageText.style.pointerEvents = 'none';
            damageText.style.zIndex = '1100';
            damageText.style.opacity = '1';
            damageText.style.transition = 'opacity 1s, transform 1s';
            
            document.getElementById('game-container').appendChild(damageText);
            
            // Animate and remove after animation
            setTimeout(() => {
                damageText.style.opacity = '0';
                damageText.style.transform = 'translate(-50%, -100%)';
                
                setTimeout(() => {
                    if (damageText.parentNode) {
                        damageText.parentNode.removeChild(damageText);
                    }
                }, 1000);
            }, 50);
        }
        
        // Play hit sound
        if (this.soundManager) {
            this.soundManager.playSound("hurt", 0.7);
        }
    }

    /**
     * Fix hit zones for players in QuickDraw mode
     */
    fixHitZonesForQuickDraw() {
        // First, try to fix local player's hit zones
        if (window.playersMap && this.localPlayer && this.localPlayer.id) {
            console.log('Fixing hit zones for QuickDraw mode');
            
            // Add local player to playersMap for bullet collision detection
            const localPlayerId = this.localPlayer.id.toString();
            if (!window.playersMap.has(localPlayerId) && this.localPlayerModel) {
                window.playersMap.set(localPlayerId, this.localPlayerModel);
                console.log(`Added local player ${localPlayerId} to players map for hit detection`);
            }
            
            // Make sure opponent is in the playersMap
            if (this.duelOpponentId && !window.playersMap.has(this.duelOpponentId.toString())) {
                // Try to find the opponent in remotePlayers
                if (window.remotePlayers && window.remotePlayers.has(this.duelOpponentId.toString())) {
                    const opponentModel = window.remotePlayers.get(this.duelOpponentId.toString());
                    if (opponentModel) {
                        window.playersMap.set(this.duelOpponentId.toString(), opponentModel);
                        console.log(`Added opponent ${this.duelOpponentId} to players map for hit detection`);
                    }
                }
            }
            
            // Setup hit zones mapping for all players in the map
            for (const [playerId, playerModel] of window.playersMap.entries()) {
                if (playerModel) {
                    // Check if the model has hitboxes but no hitZones mapping
                    if ((playerModel.headHitbox || playerModel.bodyHitbox || playerModel.limbsHitbox) && 
                        !playerModel.hitZones) {
                        
                        console.log(`Creating hitZones mapping for player ${playerId}`);
                        
                        // Create the mapping of hitboxes to hitZones
                        playerModel.hitZones = {
                            head: playerModel.headHitbox,
                            body: playerModel.bodyHitbox,
                            legs: playerModel.limbsHitbox
                        };
                        
                        // Make sure updateHitZones properly updates the hitZones mapping
                        const originalUpdateMethod = playerModel.updateCollisionBox;
                        if (originalUpdateMethod && !playerModel._hitZonesMappingAdded) {
                            playerModel._hitZonesMappingAdded = true;
                            playerModel.updateCollisionBox = function() {
                                // Call the original method first
                                originalUpdateMethod.call(this);
                                
                                // Update the hitZones mapping
                                if (this.hitZones) {
                                    this.hitZones.head = this.headHitbox;
                                    this.hitZones.body = this.bodyHitbox;
                                    this.hitZones.legs = this.limbsHitbox;
                                }
                            };
                            
                            // Force an update
                            playerModel.updateCollisionBox();
                            console.log(`Enhanced updateCollisionBox for player ${playerId} to maintain hitZones mapping`);
                        }
                    }
                }
            }
            
            // Fix visible hit zones for debugging
            if (window.showHitZoneDebug) {
                if (window.physics && typeof window.physics.refreshHitZoneDebug === 'function') {
                    window.physics.refreshHitZoneDebug();
                    console.log('Refreshed hit zone debug visualization');
                }
            }
        }
    }

    /**
     * Handle shooting in Quick Draw mode.
     * This is called when the player fires during a Quick Draw duel.
     */
    handleShoot() {
        // Do not allow shooting if not in the draw phase
        if (this.duelState !== 'draw') {
            console.log('Cannot shoot yet - waiting for draw signal');
            return false;
        }
        
        console.log('Player fired in Quick Draw mode!');
        
        // Check if opponent is visible in the scene
        const opponentId = this.duelOpponentId?.toString();
        if (!opponentId) {
            console.error('No opponent ID found for shooting');
            return false;
        }
        
        // Try to find opponent in players map
        let opponentModel = null;
        let opponentHitZones = null;
        let opponentFound = false;
        
        // First try ALL possible player maps
        const playerMaps = [
            { name: 'playersMap', map: window.playersMap },
            { name: 'remotePlayers', map: window.remotePlayers },
            { name: 'otherPlayers', map: window.otherPlayers }
        ];
        
        // Debug - list all player IDs in all maps
        console.log('DEBUGGING ALL PLAYER MAPS:');
        for (const mapInfo of playerMaps) {
            if (mapInfo.map) {
                console.log(`${mapInfo.name} contents:`);
                for (const [pid, model] of mapInfo.map.entries()) {
                    console.log(`- Player ${pid}: ${model ? 'found' : 'missing'}`);
                    
                    // If this is our opponent, store the model
                    if (pid === opponentId && model && !opponentModel) {
                        console.log(`Found opponent ${opponentId} in ${mapInfo.name}`);
                        opponentModel = model;
                        opponentFound = true;
                        
                        // Add to playersMap for future reference
                        if (window.playersMap && mapInfo.name !== 'playersMap') {
                            window.playersMap.set(opponentId, model);
                        }
                    }
                }
            } else {
                console.log(`${mapInfo.name} not available`);
            }
        }
        
        // Special case: Try to use opponent position data if available
        if (!opponentModel && this.networkManager && this.networkManager.otherPlayers) {
            const opponentData = this.networkManager.otherPlayers.get(opponentId);
            if (opponentData) {
                console.log(`Found opponent ${opponentId} position data in networkManager`);
                opponentFound = true;
                
                // Create emergency model with position
                opponentModel = {
                    id: opponentId,
                    position: new THREE.Vector3(
                        opponentData.position.x,
                        opponentData.position.y,
                        opponentData.position.z
                    ),
                    group: new THREE.Group()
                };
                
                // Position the group
                if (opponentModel.position) {
                    opponentModel.group.position.copy(opponentModel.position);
                }
                
                // Add to scene temporarily
                if (this.scene) {
                    this.scene.add(opponentModel.group);
                    
                    // Schedule removal
                    setTimeout(() => {
                        if (this.scene && opponentModel.group) {
                            this.scene.remove(opponentModel.group);
                        }
                    }, 100);
                }
            }
        }
        
        // If we found an opponent model, check for hit zones
        if (opponentModel) {
            if (opponentModel.hitZones) {
                opponentHitZones = opponentModel.hitZones;
            }
            else if (opponentModel.headHitbox || opponentModel.bodyHitbox || opponentModel.limbsHitbox) {
                // Create hitZones mapping from individual hitboxes
                opponentHitZones = {
                    head: opponentModel.headHitbox,
                    body: opponentModel.bodyHitbox,
                    legs: opponentModel.limbsHitbox
                };
                
                // Store on the model
                opponentModel.hitZones = opponentHitZones;
                console.log('Created hitZones mapping from individual hitboxes');
            }
        }
        
        // If still no model found, log error
        if (!opponentFound) {
            console.error(`Cannot find opponent model for player ${opponentId}`);
            
            // List available players for debug
            console.log('Available players in playersMap:');
            if (window.playersMap) {
                for (const [pid, model] of window.playersMap.entries()) {
                    console.log(`- Player ${pid}: ${model ? 'found' : 'missing'}`);
                }
            }
            
            console.log('Available players in remotePlayers:');
            if (window.remotePlayers) {
                for (const [pid, model] of window.remotePlayers.entries()) {
                    console.log(`- Player ${pid}: ${model ? 'found' : 'missing'}`);
                }
            }
        }
        
        // Check if we have valid hit zones
        if (!opponentHitZones) {
            console.warn(`No hit zones found for opponent ${opponentId}`);
            
            // Emergency fallback - create temporary hit zone for opponent if we have a position
            if (opponentModel && opponentModel.group) {
                console.log('Creating emergency hit zones for opponent');
                
                // Create a simple box hit zone around the opponent
                const boundingBox = new THREE.Box3().setFromObject(opponentModel.group);
                const size = boundingBox.getSize(new THREE.Vector3());
                const center = boundingBox.getCenter(new THREE.Vector3());
                
                // Create a simple hit zone object
                opponentHitZones = {
                    head: new THREE.Box3(
                        new THREE.Vector3(center.x - size.x/4, center.y + size.y/4, center.z - size.x/4),
                        new THREE.Vector3(center.x + size.x/4, center.y + size.y/2, center.z + size.x/4)
                    ),
                    body: new THREE.Box3(
                        new THREE.Vector3(center.x - size.x/3, center.y - size.y/4, center.z - size.x/3),
                        new THREE.Vector3(center.x + size.x/3, center.y + size.y/4, center.z + size.x/3)
                    ),
                    legs: new THREE.Box3(
                        new THREE.Vector3(center.x - size.x/3, center.y - size.y/2, center.z - size.x/3),
                        new THREE.Vector3(center.x + size.x/3, center.y - size.y/4, center.z + size.x/3)
                    )
                };
                
                // Store the hit zones on the model
                opponentModel.hitZones = opponentHitZones;
                console.log('Emergency hit zones created based on model position');
            } 
            else if (opponentFound) {
                // If we have opponent data but no model/group, create basic hit zones based on fixed dimensions
                const opponentPos = opponentModel.position || this.getOpponentPosition() || new THREE.Vector3(0, 2, -10);
                
                if (opponentPos) {
                    const playerHeight = 3.0;
                    const playerWidth = 1.0;
                    
                    // Create basic hit zones at opponent position
                    opponentHitZones = {
                        head: new THREE.Box3(
                            new THREE.Vector3(opponentPos.x - playerWidth/4, opponentPos.y + playerHeight*0.6, opponentPos.z - playerWidth/4),
                            new THREE.Vector3(opponentPos.x + playerWidth/4, opponentPos.y + playerHeight*0.9, opponentPos.z + playerWidth/4)
                        ),
                        body: new THREE.Box3(
                            new THREE.Vector3(opponentPos.x - playerWidth/2, opponentPos.y + playerHeight*0.2, opponentPos.z - playerWidth/2),
                            new THREE.Vector3(opponentPos.x + playerWidth/2, opponentPos.y + playerHeight*0.6, opponentPos.z + playerWidth/2)
                        ),
                        legs: new THREE.Box3(
                            new THREE.Vector3(opponentPos.x - playerWidth/2, opponentPos.y, opponentPos.z - playerWidth/2),
                            new THREE.Vector3(opponentPos.x + playerWidth/2, opponentPos.y + playerHeight*0.2, opponentPos.z + playerWidth/2)
                        )
                    };
                    
                    console.log('Created emergency hit zones based on position data');
                    
                    // Store on the model if we have one
                    if (opponentModel) {
                        opponentModel.hitZones = opponentHitZones;
                    }
                }
            }
        }
        
        // Get bullet direction from player camera
        const camera = this.localPlayer.camera;
        const bulletDirection = new THREE.Vector3(0, 0, -1);
        bulletDirection.applyQuaternion(camera.quaternion);
        
        // Create ray for bullet path (removed mobile-specific offset)
        const bulletOrigin = new THREE.Vector3();
        camera.getWorldPosition(bulletOrigin);
        
        // Offset slightly to account for gun position
        bulletOrigin.add(new THREE.Vector3(
            bulletDirection.x * 0.2,
            bulletDirection.y * 0.2,
            bulletDirection.z * 0.2
        ));
        
        const bulletRay = new THREE.Raycaster(bulletOrigin, bulletDirection, 0, 100);
        
        // Visualize bullet path for debugging
        if (this.debug) {
            const debugEndPoint = bulletOrigin.clone().add(bulletDirection.clone().multiplyScalar(100));
            this.drawBulletPath(bulletOrigin.clone(), debugEndPoint);
        }
        
        // Check for a hit
        let hitZone = null;
        let hitDistance = Infinity;
        let hitDetected = false;
        
        // Check intersection with each hit zone
        if (opponentHitZones) {
            // Check head hit
            if (opponentHitZones.head) {
                const headIntersection = bulletRay.ray.intersectBox(opponentHitZones.head, new THREE.Vector3());
                if (headIntersection) {
                    const distance = headIntersection.distanceTo(bulletOrigin);
                    if (distance < hitDistance) {
                        hitZone = 'head';
                        hitDistance = distance;
                        hitDetected = true;
                        console.log(`HEAD HIT at distance ${distance.toFixed(2)}`);
                    }
                }
            }
            
            // Check body hit
            if (opponentHitZones.body) {
                const bodyIntersection = bulletRay.ray.intersectBox(opponentHitZones.body, new THREE.Vector3());
                if (bodyIntersection) {
                    const distance = bodyIntersection.distanceTo(bulletOrigin);
                    if (distance < hitDistance) {
                        hitZone = 'body';
                        hitDistance = distance;
                        hitDetected = true;
                        console.log(`BODY HIT at distance ${distance.toFixed(2)}`);
                    }
                }
            }
            
            // Check legs hit
            if (opponentHitZones.legs) {
                const legsIntersection = bulletRay.ray.intersectBox(opponentHitZones.legs, new THREE.Vector3());
                if (legsIntersection) {
                    const distance = legsIntersection.distanceTo(bulletOrigin);
                    if (distance < hitDistance) {
                        hitZone = 'legs';
                        hitDistance = distance;
                        hitDetected = true;
                        console.log(`LEGS HIT at distance ${distance.toFixed(2)}`);
                    }
                }
            }
        }
        
        // If we have a hit, send it to the server
        if (hitDetected && hitZone) {
            console.log(`Hit opponent ${opponentId} in the ${hitZone}!`);
            
            // Calculate damage based on hit zone
            let damage = 40; // Default body damage
            if (hitZone === 'head') {
                damage = 100; // One-shot kill for headshot
            } else if (hitZone === 'legs') {
                damage = 25; // Less damage for leg hit
            }
            
            // Send hit to server with hit detection flag
            this.networkManager.sendQuickDrawShoot(opponentId, 0, hitZone, damage, true);
            
            // Show hit marker
            this.showHitMarker(hitZone);
            
            return true;
        } else {
            console.log('Missed the opponent');
            
            // Send miss to server with hit detection flag
            this.networkManager.sendQuickDrawShoot(opponentId, 0, 'miss', 0, true);
            
            return false;
        }
    }

    /**
     * Draw a line representing the bullet path (for debugging)
     */
    drawBulletPath(start, end) {
        // Remove any existing debug line
        if (this.bulletPathLine) {
            this.scene.remove(this.bulletPathLine);
            this.bulletPathLine = null;
        }
        
        // Create line geometry
        const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
        
        // Create line material
        const material = new THREE.LineBasicMaterial({ 
            color: 0xff0000,
            transparent: true,
            opacity: 0.7
        });
        
        // Create line and add to scene
        this.bulletPathLine = new THREE.Line(geometry, material);
        this.scene.add(this.bulletPathLine);
        
        // Auto-remove after 2 seconds
        setTimeout(() => {
            if (this.bulletPathLine) {
                this.scene.remove(this.bulletPathLine);
                this.bulletPathLine = null;
            }
        }, 2000);
    }

    /**
     * Show a hit marker on the screen
     */
    showHitMarker(hitZone) {
        // Create hit marker element if it doesn't exist
        if (!this.hitMarker) {
            this.hitMarker = document.createElement('div');
            this.hitMarker.style.position = 'absolute';
            this.hitMarker.style.top = '50%';
            this.hitMarker.style.left = '50%';
            this.hitMarker.style.transform = 'translate(-50%, -50%)';
            this.hitMarker.style.width = '40px';
            this.hitMarker.style.height = '40px';
            this.hitMarker.style.backgroundImage = 'url("/assets/hitmarker.png")';
            this.hitMarker.style.backgroundSize = 'contain';
            this.hitMarker.style.backgroundRepeat = 'no-repeat';
            this.hitMarker.style.pointerEvents = 'none';
            this.hitMarker.style.zIndex = '1000';
            this.hitMarker.style.opacity = '0';
            this.hitMarker.style.transition = 'opacity 0.1s ease-in-out';
            
            document.body.appendChild(this.hitMarker);
        }
        
        // Set color based on hit zone
        let color = '#ffffff';
        if (hitZone === 'head') {
            color = '#ff0000'; // Red for headshot
            
            // Play headshot sound
            if (window.audioManager) {
                window.audioManager.playSound('headshot', 0.7);
            }
        }
        
        // Set color and show hit marker
        this.hitMarker.style.filter = `brightness(1.5) drop-shadow(0 0 2px ${color})`;
        this.hitMarker.style.opacity = '1';
        
        // Play hit sound
        if (window.audioManager) {
            window.audioManager.playSound('hit_marker', 0.5);
        }
        
        // Hide after a short delay
        setTimeout(() => {
            if (this.hitMarker) {
                this.hitMarker.style.opacity = '0';
            }
        }, 300);
    }

    /**
     * Initialize Quick Draw mode
     */
    init() {
        console.log('Initializing Quick Draw mode');
        this.debug = false;  // Set to true to enable debug logging
        
        // Initialize network handlers
        this.initNetworkHandlers();
        
        // Hook into player shooting actions
        this.hookPlayerShooting();
        
        // Initialize UI elements
        this.initUI();
        
        // Initialize the aerial camera
        this.initAerialCamera();
        
        // Initialize hit zone debugging if needed
        if (this.debug) {
            this.initHitZoneDebugging();
        }
    }

    /**
     * Hook into player shooting actions to handle Quick Draw specific logic
     */
    hookPlayerShooting() {
        // Store original shoot method
        if (this.localPlayer && !this.localPlayer._originalShoot) {
            // Store original shoot method if it exists
            this.localPlayer._originalShoot = this.localPlayer.shoot;
            
            // Override shoot method
            this.localPlayer.shoot = (...args) => {
                // If we're in a duel, handle QuickDraw specific shooting
                if (this.inDuel && this.duelState === 'draw') {
                    console.log('QuickDraw shooting detected');
                    
                    // First check if player is allowed to shoot
                    if (!this.localPlayer.canAim) {
                        console.log('Cannot shoot - player aiming is disabled');
                        return false;
                    }
                    
                    // Check if the opponent should be hit
                    const hitResult = this.handleShoot();
                    
                    // Call original shoot method to handle animations and effects
                    // but with a flag to prevent double processing
                    if (this.localPlayer._originalShoot) {
                        // Create a context object to pass to the original method
                        const shootContext = {
                            _quickDrawProcessed: true,
                            hitResult: hitResult
                        };
                        
                        // Call original with our quickdraw context
                        return this.localPlayer._originalShoot.apply(this.localPlayer, [...args, shootContext]);
                    }
                    
                    return hitResult;
                } else {
                    // Not in QuickDraw - use original shoot method
                    if (this.localPlayer._originalShoot) {
                        return this.localPlayer._originalShoot.apply(this.localPlayer, args);
                    }
                }
                
                return false;
            };
            
            console.log('Hooked player shooting for QuickDraw mode');
        }
        
        // Also hook into the input manager to detect mouse clicks during Quick Draw
        if (window.inputManager && !window.inputManager._quickDrawHooked) {
            // Store original mouse down handler
            const originalMouseDown = window.inputManager.handleMouseDown;
            
            // Override mouse down handler
            window.inputManager.handleMouseDown = (event) => {
                // Call original handler first
                if (originalMouseDown) {
                    originalMouseDown.call(window.inputManager, event);
                }
                
                // Additional QuickDraw specific logic
                if (this.inDuel && this.duelState === 'draw') {
                    // Left mouse button
                    if (event.button === 0) {
                        // Check if player tried to shoot before allowed
                        if (!this.localPlayer.canAim) {
                            console.log('Player tried to shoot too early!');
                            
                            // Apply penalty for shooting too early
                            this.applyEarlyShootPenalty();
                        }
                    }
                }
            };
            
            // Mark as hooked
            window.inputManager._quickDrawHooked = true;
            console.log('Hooked input manager for QuickDraw mode');
        }
    }

    /**
     * Apply penalty for shooting too early
     */
    applyEarlyShootPenalty() {
        console.log('Applying penalty for shooting too early');
        
        // Notify server about penalty
        this.networkManager.sendQuickDrawPenalty();
        
        // Disable aiming for 3 seconds as penalty
        this.localPlayer.canAim = false;
        this.penaltyEndTime = Date.now() + 3000;
        
        // Show penalty message
        this.showMessage('Too Early! Penalty: 3s', 2000, '#ff0000');
        
        // Schedule re-enabling of aiming after penalty time
        setTimeout(() => {
            if (this.inDuel && this.duelState === 'draw') {
                this.localPlayer.canAim = true;
                console.log('Penalty ended, player can now aim');
            }
        }, 3000);
    }

    /**
     * Initialize hit zone debugging if needed
     */
    initHitZoneDebugging() {
        console.log('Initializing hit zone debugging');
        
        // Create toggle button
        const debugButton = document.createElement('button');
        debugButton.innerText = 'Toggle Hit Zones';
        debugButton.style.position = 'absolute';
        debugButton.style.bottom = '10px';
        debugButton.style.right = '10px';
        debugButton.style.zIndex = '1000';
        debugButton.style.padding = '5px 10px';
        debugButton.style.background = 'rgba(0,0,0,0.7)';
        debugButton.style.color = 'white';
        debugButton.style.border = '1px solid #666';
        debugButton.style.borderRadius = '4px';
        
        // Add to DOM
        document.body.appendChild(debugButton);
        
        // Toggle hit zone visualization
        let hitZonesVisible = false;
        debugButton.addEventListener('click', () => {
            hitZonesVisible = !hitZonesVisible;
            debugButton.innerText = hitZonesVisible ? 'Hide Hit Zones' : 'Show Hit Zones';
            
            // Set global flag
            window.showHitZoneDebug = hitZonesVisible;
            
            // Update visualization
            this.visualizeHitZones(hitZonesVisible);
        });
    }

    /**
     * Visualize hit zones for debugging
     */
    visualizeHitZones(show) {
        // Clean up existing visualizations
        if (this.hitZoneHelpers) {
            for (const helper of this.hitZoneHelpers) {
                this.scene.remove(helper);
            }
        }
        
        // Initialize array
        this.hitZoneHelpers = [];
        
        // Exit if not showing
        if (!show) return;
        
        // First, ensure hit zone mappings are created for all players
        this.fixHitZonesForQuickDraw();
        
        // Create helpers for local player model too, if available
        if (this.localPlayerModel) {
            console.log('Visualizing local player hit zones');
            
            // Try hitZones mapping first
            if (this.localPlayerModel.hitZones) {
                for (const [zone, box] of Object.entries(this.localPlayerModel.hitZones)) {
                    const color = zone === 'head' ? 0xff0000 : (zone === 'body' ? 0x00ff00 : 0x0000ff);
                    const helper = new THREE.Box3Helper(box, color);
                    this.scene.add(helper);
                    this.hitZoneHelpers.push(helper);
                }
            } 
            // Fall back to individual hitboxes if available
            else if (this.localPlayerModel.headHitbox || this.localPlayerModel.bodyHitbox || this.localPlayerModel.limbsHitbox) {
                if (this.localPlayerModel.headHitbox) {
                    const helper = new THREE.Box3Helper(this.localPlayerModel.headHitbox, 0xff0000);
                    this.scene.add(helper);
                    this.hitZoneHelpers.push(helper);
                }
                
                if (this.localPlayerModel.bodyHitbox) {
                    const helper = new THREE.Box3Helper(this.localPlayerModel.bodyHitbox, 0x00ff00);
                    this.scene.add(helper);
                    this.hitZoneHelpers.push(helper);
                }
                
                if (this.localPlayerModel.limbsHitbox) {
                    const helper = new THREE.Box3Helper(this.localPlayerModel.limbsHitbox, 0x0000ff);
                    this.scene.add(helper);
                    this.hitZoneHelpers.push(helper);
                }
            }
        }
        
        // Create helpers for our opponent
        const opponentId = this.duelOpponentId?.toString();
        if (opponentId) {
            let opponentModel = null;
            
            // Try different sources for opponent model
            if (window.playersMap && window.playersMap.has(opponentId)) {
                opponentModel = window.playersMap.get(opponentId);
            } else if (window.remotePlayers && window.remotePlayers.has(opponentId)) {
                opponentModel = window.remotePlayers.get(opponentId);
            } else if (window.otherPlayers && window.otherPlayers.has(opponentId)) {
                opponentModel = window.otherPlayers.get(opponentId);
            }
            
            if (opponentModel) {
                console.log('Visualizing opponent hit zones');
                
                // Try hitZones mapping first
                if (opponentModel.hitZones) {
                    for (const [zone, box] of Object.entries(opponentModel.hitZones)) {
                        const color = zone === 'head' ? 0xff0000 : (zone === 'body' ? 0x00ff00 : 0x0000ff);
                        const helper = new THREE.Box3Helper(box, color);
                        this.scene.add(helper);
                        this.hitZoneHelpers.push(helper);
                    }
                } 
                // Fall back to individual hitboxes if available
                else if (opponentModel.headHitbox || opponentModel.bodyHitbox || opponentModel.limbsHitbox) {
                    if (opponentModel.headHitbox) {
                        const helper = new THREE.Box3Helper(opponentModel.headHitbox, 0xff0000);
                        this.scene.add(helper);
                        this.hitZoneHelpers.push(helper);
                    }
                    
                    if (opponentModel.bodyHitbox) {
                        const helper = new THREE.Box3Helper(opponentModel.bodyHitbox, 0x00ff00);
                        this.scene.add(helper);
                        this.hitZoneHelpers.push(helper);
                    }
                    
                    if (opponentModel.limbsHitbox) {
                        const helper = new THREE.Box3Helper(opponentModel.limbsHitbox, 0x0000ff);
                        this.scene.add(helper);
                        this.hitZoneHelpers.push(helper);
                    }
                }
                // If no hit zones, try to create them
                else if (opponentModel.group) {
                    console.log('Creating on-the-fly hit zones for visualization');
                    
                    // Calculate bounding box from the model
                    const boundingBox = new THREE.Box3().setFromObject(opponentModel.group);
                    const size = boundingBox.getSize(new THREE.Vector3());
                    const center = boundingBox.getCenter(new THREE.Vector3());
                    
                    // Create basic hitboxes for visualization
                    const headBox = new THREE.Box3(
                        new THREE.Vector3(center.x - size.x/4, center.y + size.y/4, center.z - size.x/4),
                        new THREE.Vector3(center.x + size.x/4, center.y + size.y/2, center.z + size.x/4)
                    );
                    
                    const bodyBox = new THREE.Box3(
                        new THREE.Vector3(center.x - size.x/3, center.y - size.y/4, center.z - size.x/3),
                        new THREE.Vector3(center.x + size.x/3, center.y + size.y/4, center.z + size.x/3)
                    );
                    
                    const legsBox = new THREE.Box3(
                        new THREE.Vector3(center.x - size.x/3, center.y - size.y/2, center.z - size.x/3),
                        new THREE.Vector3(center.x + size.x/3, center.y - size.y/4, center.z + size.x/3)
                    );
                    
                    // Create helpers
                    const headHelper = new THREE.Box3Helper(headBox, 0xff0000);
                    const bodyHelper = new THREE.Box3Helper(bodyBox, 0x00ff00);
                    const legsHelper = new THREE.Box3Helper(legsBox, 0x0000ff);
                    
                    // Add to scene
                    this.scene.add(headHelper);
                    this.scene.add(bodyHelper);
                    this.scene.add(legsHelper);
                    
                    // Track helpers
                    this.hitZoneHelpers.push(headHelper, bodyHelper, legsHelper);
                }
            }
        }
    }

    /**
     * Handle countdown notification from server.
     * @param {Object} message - The countdown message
     */
    handleCountdown(message) {
        console.log('Received countdown notification from server');
        this.startDuelCountdown();
    }

    /**
     * Handle kill notification from server.
     * @param {Object} message - The kill message
     */
    handleKill(message) {
        console.log(`You killed player ${message.targetId}`);
        
        // Set death/kill animation flag
        this.inDeathOrKillAnimation = true;
        
        // Show kill message
        this.showMessage('KILL!', 1500, '#00FF00');
        
        // Play kill sound
        if (this.soundManager) {
            this.soundManager.playSound("kill", 0.7);
        }
        
        // Create kill effect
        this.createKillEffect();
        
        // Ensure the local player's camera remains active
        if (window.renderer && this.localPlayer) {
            window.renderer.camera = this.localPlayer.camera;
            
            // Also set the instance camera if available
            if (window.renderer.instance) {
                window.renderer.instance.camera = this.localPlayer.camera;
            }
        }
        
        // Clear animation flag after a delay
        setTimeout(() => {
            this.inDeathOrKillAnimation = false;
        }, 3000); // Enough time for death animation to complete
    }

    /**
     * Handle death notification from server.
     * @param {Object} message - The death message
     */
    handleDeath(message) {
        console.log(`You were killed by player ${message.killerId}`);
        
        // Set death/kill animation flag to prevent camera switching
        this.inDeathOrKillAnimation = true;
        
        // Skip showing "YOU DIED" message if this is a duel death (we'll show DEFEAT instead)
        if (!this.inDuel) {
            // Show death message only for non-duel deaths
            this.showMessage('YOU DIED', 1500, '#FF0000');
        }
        
        // Play death sound
        if (this.soundManager) {
            this.soundManager.playSound("death", 0.7);
        }
        
        // Create death effect
        this.createDeathEffect();
        
        // Make sure we have a local player model for the death animation
        if (!this.localPlayerModel) {
            this.createLocalPlayerModel();
        }
        
        // Store original mouse handler for later restoration
        const origMouseMove = document.onmousemove;
        
        // Keep the player's POV camera active during death
        if (this.localPlayerModel) {
            // Force the local player's camera to be active
            if (window.renderer) {
                window.renderer.camera = this.localPlayer.camera;
                
                // Also set the instance camera if available
                if (window.renderer.instance) {
                    window.renderer.instance.camera = this.localPlayer.camera;
                }
            }
            
            // Save original camera rotation
            const originalRotation = this.localPlayer.camera.rotation.clone();
            
            // Apply death camera rotation - rotate camera to look down at the ground
            // Start a smooth rotation animation from current position to looking down
            const deathCameraDuration = 1000; // 1 second for the rotation animation
            const startTime = Date.now();
            const targetRotationX = Math.PI / 2; // Looking down at the ground (90 degrees) instead of up
            
            // Create an animation function that rotates the camera over time
            const rotateCameraUp = () => {
                const elapsed = Date.now() - startTime;
                const progress = Math.min(elapsed / deathCameraDuration, 1);
                
                // Use an easing function (ease-out) for smoother animation
                const easeOut = 1 - Math.pow(1 - progress, 2);
                
                // Interpolate between original and target rotation
                this.localPlayer.camera.rotation.x = originalRotation.x * (1 - easeOut) + targetRotationX * easeOut;
                
                // Continue the animation until complete
                if (progress < 1) {
                    requestAnimationFrame(rotateCameraUp);
                }
            };
            
            // Start the camera rotation animation
            rotateCameraUp();
            
            // Make the model visible for other players but not in our own view
            this.localPlayerModel.group.visible = true;
            
            // Play the death animation
            if (this.localPlayerModel.playDeathAnimation) {
                console.log('[QuickDraw] Playing death animation');
                const deathResult = this.localPlayerModel.playDeathAnimation();
                
                // Play the player fall sound when death animation starts
                if (this.soundManager) {
                    this.soundManager.playSound("playerfall", 0, 0.8);
                }
                
                // Allow the death animation to complete before reset/respawn
                const deathAnimDuration = deathResult.duration || 1500;
                
                // Disable player controls during death animation
                if (this.localPlayer) {
                    this.localPlayer.canMove = false;
                    this.localPlayer.canAim = false;
                    this.localPlayer.forceLockMovement = true;
                    
                    // Disable mouse look temporarily to prevent camera movement
                    document.onmousemove = (e) => {
                        // Block mouse movement during death animation
                        e.stopPropagation();
                        return false;
                    };
                }
                
                // Wait for animation to complete before server sends respawn
                console.log(`[QuickDraw] Death animation playing, duration: ${deathAnimDuration}ms`);
                
                // Clear animation flag after animation completes
                setTimeout(() => {
                    this.inDeathOrKillAnimation = false;
                }, deathAnimDuration + 500); // Add a bit of buffer
                
                // The server will send fullStateReset message after the animation duration
                // We're ensuring the animation has time to play fully
                
                // Broadcast our death animation state to other players
                if (this.networkManager && this.networkManager.socket) {
                    this.networkManager.socket.send(JSON.stringify({
                        type: 'playerUpdate',
                        isDying: true,  // Special flag to trigger death animation on other clients
                        health: 0,
                        position: this.localPlayer.group.position,
                        rotation: { y: this.localPlayer.group.rotation.y }
                    }));
                    console.log('[QuickDraw] Broadcast death animation state to other players');
                }
            } else {
                console.warn('[QuickDraw] Death animation not available on player model');
                
                // Clear animation flag after a default delay if no animation
                setTimeout(() => {
                    this.inDeathOrKillAnimation = false;
                }, 3000);
            }
        } else {
            console.warn('[QuickDraw] Could not create local player model for death animation');
            
            // Clear animation flag after a default delay if no model
            setTimeout(() => {
                this.inDeathOrKillAnimation = false;
            }, 3000);
        }
    }

    /**
     * Handle duel result notification from server.
     * @param {Object} message - The result message
     */
    handleResult(message) {
        console.log(`[QuickDraw] Duel ended. Winner: ${message.winnerId}`);
        
        // Show the victory/defeat screen and visual effects
        this.endDuel(message.winnerId);
        
        // We no longer need to manually manage death animations here
        // because the server will send playerDeath, death, and kill messages
        // which will be handled by the existing handlers
        console.log('[QuickDraw] Death animation will be handled by standard death/kill handlers');
        
        // The server will send a respawn message after the death animation completes
    }
    
    /**
     * Reset all player state variables
     */
    resetPlayerState() {
        if (!this.localPlayer) return;
        
        console.log('[QuickDraw] Resetting player state completely');
        
        // Reset movement flags
        this.localPlayer.canMove = true;
        this.localPlayer.canAim = true;
        this.localPlayer.forceLockMovement = false;
        this.localPlayer.forceLockRotation = false;
        
        // Reset weapon state
        this.localPlayer.isAiming = false;
        this.localPlayer.isReloading = false;
        this.localPlayer.isShooting = false;
        this.localPlayer.bullets = this.localPlayer.maxBullets || 6;
        
        // Reset health
        this.localPlayer.health = 100;
        
        // Reset animation state if there's a viewmodel
        if (this.localPlayer.viewmodel) {
            this.localPlayer.viewmodel.visible = true;
            
            // Reset gun position to holster
            if (this.localPlayer.currentGunOffset && this.localPlayer.holsterOffset) {
                this.localPlayer.currentGunOffset.copy(this.localPlayer.holsterOffset);
            }
            
            // Clear any ongoing gun animation
            if (this.localPlayer.gunAnimation) {
                this.localPlayer.gunAnimation.reset();
                this.localPlayer.gunAnimation = null;
            }
        }
        
        // Reset any original movement methods that might have been backed up
        if (this.localPlayer._origMove) {
            this.localPlayer.move = this.localPlayer._origMove;
            this.localPlayer._origMove = null;
        }
        
        // Ensure player nametags are restored
        this.restorePlayerNametags();
        
        // Ensure letterbox effect is removed
        document.body.classList.remove('letterbox-active');
        
        // Reset quickdraw specific state
        this.inDuel = false;
        this.inLobby = false;
        this.duelState = 'none';
        this.duelOpponentId = null;
        this.duelActive = false;
        
        // Update UI
        if (typeof updateHealthUI === 'function') {
            updateHealthUI(this.localPlayer);
        }
        
        console.log('[QuickDraw] Player state reset complete');
    }
    
    /**
     * Respawn player at a random town position
     */
    respawnPlayerInTown() {
        if (!this.localPlayer) return;
        
        console.log('[QuickDraw] Respawning player in town');
        
        // Use the scene's spawn function if available
        if (this.scene && this.scene.spawnPlayer) {
            this.scene.spawnPlayer(this.localPlayer, true);
            console.log('[QuickDraw] Player respawned using scene spawnPlayer');
        } else {
            // Fallback: manual respawn at a random town position
            const townWidth = 60;  // Taken from GAME_CONSTANTS on server
            const townLength = 100; // Taken from GAME_CONSTANTS on server
            
            // Generate random position within town bounds
            const spawnX = (Math.random() - 0.5) * townWidth * 0.8;
            const spawnY = 1.6; // Standard player height
            const spawnZ = (Math.random() - 0.5) * townLength * 0.8;
            
            // Set player position
            this.localPlayer.group.position.set(spawnX, spawnY, spawnZ);
            console.log(`[QuickDraw] Player respawned at random town position: (${spawnX.toFixed(2)}, ${spawnY.toFixed(2)}, ${spawnZ.toFixed(2)})`);
        }
        
        // Reset velocity (especially important for y velocity)
        this.localPlayer.velocity = new THREE.Vector3(0, 0, 0);
        
        // Ensure the local player's camera is active
        if (this.scene && this.scene.renderer) {
            this.scene.renderer.camera = this.localPlayer.camera;
            this.scene.renderer.overrideCamera = null;
        }
        
        // Remove any third-person model of the local player
        this.removeLocalPlayerModel();
    }
    
    /**
     * Remove the local player's third-person model if it exists
     */
    removeLocalPlayerModel() {
        if (this.localPlayerModel) {
            console.log('[QuickDraw] Removing local player model');
            
            // Reset animation states to ensure clean state for next use
            this.localPlayerModel.isDying = false;
            this.localPlayerModel.isAiming = false;
            this.localPlayerModel.isShooting = false;
            this.localPlayerModel.isWalking = false;
            this.localPlayerModel.isRunning = false;
            
            // Clean up any active animations
            if (this.localPlayerModel.mixer) {
                this.localPlayerModel.mixer.stopAllAction();
            }
            
            if (this.localPlayerModel.animations) {
                for (const actionName in this.localPlayerModel.animations) {
                    const action = this.localPlayerModel.animations[actionName];
                    if (action && action.stop) {
                        action.stop();
                    }
                }
            }
            
            if (this.localPlayerModel.group) {
                // Remove from scene if it's part of the scene
                if (this.localPlayerModel.group.parent) {
                    this.localPlayerModel.group.parent.remove(this.localPlayerModel.group);
                }
                
                // Or try removing directly from scene
                if (this.scene && this.scene.children) {
                    this.scene.remove(this.localPlayerModel.group);
                }
            }
            
            // Dispose of all resources
            if (typeof this.localPlayerModel.dispose === 'function') {
                this.localPlayerModel.dispose();
            }
            
            // Clear the reference
            this.localPlayerModel = null;
        }
    }
    
    /**
     * Send a message to all clients to reset this player's state
     */
    sendPlayerStateReset() {
        if (!this.networkManager || !this.localPlayer) return;
        
        console.log('[QuickDraw] Broadcasting player state reset to all clients');
        
        try {
            // Send a full player state update with reset values
            this.networkManager.socket.send(JSON.stringify({
                type: 'playerUpdate',
                position: this.localPlayer.group.position,
                rotation: { y: this.localPlayer.group.rotation.y },
                isAiming: false,
                isReloading: false,
                health: 100,
                quickDrawLobbyIndex: -1,  // Not in any quickdraw lobby
                fullReset: true  // Special flag to indicate a full state reset
            }));
            
            console.log('[QuickDraw] Player state reset broadcast complete');
        } catch (error) {
            console.error('[QuickDraw] Error sending player state reset:', error);
        }
    }

    /**
     * Create a visual effect when player gets a kill
     */
    createKillEffect() {
        // Create a green flash to indicate kill
        const killFlash = document.createElement('div');
        killFlash.style.position = 'absolute';
        killFlash.style.top = '0';
        killFlash.style.left = '0';
        killFlash.style.width = '100%';
        killFlash.style.height = '100%';
        killFlash.style.backgroundColor = 'rgba(0, 255, 0, 0.2)';
        killFlash.style.pointerEvents = 'none';
        killFlash.style.zIndex = '999';
        killFlash.style.animation = 'kill-flash 0.5s ease-out';
        
        // Add animation style
        const style = document.createElement('style');
        style.innerHTML = `
            @keyframes kill-flash {
                0% { opacity: 0.5; }
                100% { opacity: 0; }
            }
        `;
        document.head.appendChild(style);
        
        // Add to game container
        document.getElementById('game-container').appendChild(killFlash);
        
        // Remove after animation
        setTimeout(() => {
            if (killFlash.parentNode) {
                killFlash.parentNode.removeChild(killFlash);
            }
            if (style.parentNode) {
                style.parentNode.removeChild(style);
            }
        }, 500);
    }

    /**
     * Create a visual effect when player dies
     */
    createDeathEffect() {
        // Create a red vignette effect for death
        const deathOverlay = document.createElement('div');
        deathOverlay.style.position = 'absolute';
        deathOverlay.style.top = '0';
        deathOverlay.style.left = '0';
        deathOverlay.style.width = '100%';
        deathOverlay.style.height = '100%';
        deathOverlay.style.background = 'radial-gradient(ellipse at center, rgba(0,0,0,0) 0%,rgba(255,0,0,0.5) 100%)';
        deathOverlay.style.pointerEvents = 'none';
        deathOverlay.style.zIndex = '999';
        deathOverlay.style.opacity = '0';
        deathOverlay.style.animation = 'death-fade 1s ease-in forwards';
        
        // Add animation style
        const style = document.createElement('style');
        style.innerHTML = `
            @keyframes death-fade {
                0% { opacity: 0; }
                100% { opacity: 1; }
            }
        `;
        document.head.appendChild(style);
        
        // Add to game container
        document.getElementById('game-container').appendChild(deathOverlay);
        
        // Remove after animation (longer for death effect)
        setTimeout(() => {
            if (deathOverlay.parentNode) {
                deathOverlay.parentNode.removeChild(deathOverlay);
            }
            if (style.parentNode) {
                style.parentNode.removeChild(style);
            }
        }, 1500);
    }

    /**
     * Disable and remove the aerial camera.
     */
    disableAerialCamera() {
        console.log('[QuickDraw] Disabling aerial camera');
        
        // Set active flag to false first
        this.aerialCameraActive = false;
        
        // Deactivate eagle POV camera if active
        if (window.flyingEagle) {
            window.flyingEagle.deactivateAerialCamera();
            
            // Return the eagle to its default path around the town
            window.flyingEagle.returnToDefaultPath();
        }
        
        // Remove camera from scene
        if (this.aerialCamera) {
            console.log('[QuickDraw] Removing aerial camera from scene');
            
            // Remove from parent if attached
            if (this.aerialCamera.parent) {
                this.aerialCamera.parent.remove(this.aerialCamera);
            }
            // Or try removing directly from scene
            else if (this.scene && this.scene.scene) {
                this.scene.scene.remove(this.aerialCamera);
            }
            
            // Clear reference to camera
            this.aerialCamera = null;
        }
        
        // If we're not in death animation, restore original camera
        if (!this.inDeathOrKillAnimation && this.localPlayer && this.localPlayer.camera) {
            // Force switch back to player camera if not in death animation
            if (window.renderer) {
                window.renderer.camera = this.localPlayer.camera;
                
                if (window.renderer.instance) {
                    window.renderer.instance.camera = this.localPlayer.camera;
                }
            }
        }
        
        // Reset path set flag so it will be re-initialized for the next match
        this.aerialCameraPathSet = false;
    }

    /**
     * Initialize UI elements for QuickDraw mode
     */
    initUI() {
        // Skip if UI was already created
        if (this.messageOverlay) return;
        
        console.log('Initializing QuickDraw UI');
        
        // Create main UI elements
        this.createUI();
        
        // Create challenge UI elements
        this.createChallengeUI();
    }

    /**
     * Initialize aerial camera for duel mode
     */
    initAerialCamera() {
        // Create aerial camera if it doesn't exist
        if (!this.aerialCamera) {
            console.log('Creating aerial camera for QuickDraw duels');
            
            this.aerialCamera = new THREE.PerspectiveCamera(
                75, 
                window.innerWidth / window.innerHeight,
                0.1,
                1000
            );
            
            if (this.scene) {
                this.scene.add(this.aerialCamera);
            } else {
                console.error('Cannot add aerial camera - scene not available');
            }
        }
        
        // Initialize flying eagle for aerial camera if it doesn't exist
        if (!window.flyingEagle) {
            console.log('Initializing flying eagle for QuickDraw aerial view');
            window.flyingEagle = new FlyingEagle({
                scene: this.scene,
                camera: this.aerialCamera
            });
            
            // Set default town center
            const townCenter = new THREE.Vector3(0, 0, 0);
            window.flyingEagle.townCenter = townCenter;
            window.flyingEagle.setDefaultFlightPath();
        }
    }

    /**
     * Create a timeout that will be automatically cleared on cleanup
     * to prevent lingering effects when a duel ends prematurely.
     */
    createDuelTimeout(callback, delay) {
        // Initialize the array if it doesn't exist
        if (!this._duelTimers) {
            this._duelTimers = [];
        }
        
        // Create the timeout and store its ID
        const timerId = setTimeout(() => {
            // Remove this timer from the tracking array once it completes
            if (this._duelTimers) {
                const index = this._duelTimers.indexOf(timerId);
                if (index !== -1) {
                    this._duelTimers.splice(index, 1);
                }
            }
            
            // Execute the callback safely
            try {
                callback();
            } catch (error) {
                console.error('[QuickDraw] Error in timeout callback:', error);
            }
        }, delay);
        
        // Add this timer to our tracking array
        this._duelTimers.push(timerId);
        console.log(`[QuickDraw] Created duel timeout #${timerId}, total active: ${this._duelTimers.length}`);
        
        return timerId;
    }

    /**
     * Clear all duel-related timers to prevent lingering effects
     */
    clearAllDuelTimers() {
        if (!this._duelTimers) {
            return;
        }
        
        console.log(`[QuickDraw] Clearing all ${this._duelTimers.length} duel timers`);
        
        // Clear each timer and track how many we actually cleared
        let clearedCount = 0;
        const timersCopy = [...this._duelTimers]; // Create a copy to avoid modification issues
        
        for (const timerId of timersCopy) {
            clearTimeout(timerId);
            clearedCount++;
        }
        
        // Reset the array
        this._duelTimers = [];
        
        console.log(`[QuickDraw] Cleared ${clearedCount} duel timers`);
    }

    /**
     * Helper to show a message in the center of the screen.
     * @param {string} message - The message to display
     * @param {number} duration - How long to show the message (in ms)
     * @param {string} color - Optional color for the message text
     */
    showMessage(message, duration = 0, color = '') {
        // Check if messageOverlay exists
        if (!this.messageOverlay) {
            console.log('[QuickDraw] Creating missing messageOverlay for showMessage');
            // Text overlay for messages
            this.messageOverlay = document.createElement('div');
            this.messageOverlay.id = 'quick-draw-message';
            this.messageOverlay.style.position = 'absolute';
            this.messageOverlay.style.top = '50%';
            this.messageOverlay.style.left = '50%';
            this.messageOverlay.style.transform = 'translate(-50%, -50%)';
            this.messageOverlay.style.color = 'white';
            this.messageOverlay.style.fontSize = '48px';
            this.messageOverlay.style.fontWeight = 'bold';
            this.messageOverlay.style.textAlign = 'center';
            this.messageOverlay.style.display = 'none';
            this.messageOverlay.style.fontFamily = 'Western, Arial, sans-serif';
            this.messageOverlay.style.textShadow = '2px 2px 4px rgba(0, 0, 0, 0.5)';
            this.messageOverlay.style.zIndex = '1000';
            document.getElementById('game-container').appendChild(this.messageOverlay);
        }
        
        // Set message text
        this.messageOverlay.textContent = message;
        
        // Set color if provided
        if (color) {
            this.messageOverlay.style.color = color;
        } else {
            this.messageOverlay.style.color = '#FFFFFF'; // Default to white
        }
        
        // Show the message
        this.messageOverlay.style.display = 'block';
        
        // Hide after specified duration
        if (duration > 0) {
            this.createDuelTimeout(() => {
                this.hideMessage();
            }, duration);
        }
    }

    /**
     * Hide the message overlay.
     */
    hideMessage() {
        if (this.messageOverlay) {
            this.messageOverlay.style.display = 'none';
        }
    }

    /**
     * Use raycast to find the proper ground level at the given position
     * @param {Object} position - The position to check (x, z coordinates)
     * @returns {number} - The ground height at that position
     */
    findGroundHeight(position) {
        // Default ground level is 0 (flat town area)
        let groundHeight = 0;
        
        // Check if we have physics and terrain systems available
        if (window.physics) {
            // First check for terrain height (desert dunes, etc.)
            const terrainHeight = window.physics.getTerrainHeightAt(position.x, position.z);
            groundHeight = Math.max(groundHeight, terrainHeight);
            
            // Check the physics bodies to find any platform/structure at this position
            if (window.physics.bodies) {
                // Create ray start position high above the potential ground
                const rayStart = new THREE.Vector3(position.x, 50, position.z);
                
                // Check each physics body
                for (const body of window.physics.bodies) {
                    // Skip irrelevant bodies
                    if (body.arenaBoundary || body.mass > 0) continue;
                    
                    // Currently we only handle box shapes
                    for (let i = 0; i < body.shapes.length; i++) {
                        const shape = body.shapes[i];
                        if (shape.type !== CANNON.Shape.types.BOX) continue;
                        
                        // Get shape properties
                        const shapePos = new CANNON.Vec3();
                        body.pointToWorldFrame(body.shapeOffsets[i], shapePos);
                        
                        // Convert to THREE.js
                        const boxPos = new THREE.Vector3(shapePos.x, shapePos.y, shapePos.z);
                        const boxSize = new THREE.Vector3(
                            shape.halfExtents.x * 2,
                            shape.halfExtents.y * 2,
                            shape.halfExtents.z * 2
                        );
                        
                        // Check if the ray passes through this box horizontally
                        const margin = 0.5; // Small margin for precision
                        if (Math.abs(position.x - boxPos.x) <= boxSize.x/2 + margin && 
                            Math.abs(position.z - boxPos.z) <= boxSize.z/2 + margin) {
                            
                            // Get top of box
                            const topOfBox = boxPos.y + boxSize.y/2;
                            
                            // If this box is higher than current ground level, update it
                            // But only if the ray from above would hit it first
                            if (topOfBox > groundHeight && topOfBox < rayStart.y) {
                                groundHeight = topOfBox;
                                console.log(`[QuickDraw] Found elevated ground at ${groundHeight.toFixed(2)} (box: ${boxPos.x.toFixed(2)}, ${boxPos.y.toFixed(2)}, ${boxPos.z.toFixed(2)})`);
                            }
                        }
                    }
                }
            }
        }
        
        console.log(`[QuickDraw] Ground height at (${position.x.toFixed(2)}, ${position.z.toFixed(2)}) is ${groundHeight.toFixed(2)}`);
        return groundHeight;
    }

    /**
     * Properly ground a player at the specified position
     * @param {Object} position - The position to start with (will be modified)
     * @returns {Object} - The corrected position with proper eye height above ground
     */
    groundPlayerPosition(position) {
        if (!position) return position;
        
        // First find the actual ground height at this position
        const groundHeight = this.findGroundHeight(position);
        
        // Set the player's eye level to be exactly 2.72 units above ground
        const groundedPosition = {
            x: position.x,
            y: groundHeight + 2.72, // Standard eye level above ground
            z: position.z
        };
        
        console.log(`[QuickDraw] Grounded player position:`, 
            `Original: (${position.x.toFixed(2)}, ${position.y ? position.y.toFixed(2) : 'N/A'}, ${position.z.toFixed(2)})`,
            `Grounded: (${groundedPosition.x.toFixed(2)}, ${groundedPosition.y.toFixed(2)}, ${groundedPosition.z.toFixed(2)})`);
        
        return groundedPosition;
    }

    /**
     * Reset player state and respawn them at a random town position
     * @param {Object} message - The reset message from the server
     */
    resetPlayerAndRespawn(message) {
        console.log('[QuickDraw] Executing comprehensive player reset and respawn');
        
        if (!this.localPlayer) return;
        
        // First, clear all match UI elements
        this.clearMatchUI();
        
        // Clear any active timers
        this.clearAllDuelTimers();
        
        // Reset all player movement control flags
        this.localPlayer.canMove = true;
        this.localPlayer.canAim = true;
        this.localPlayer.forceLockMovement = false;
        this.localPlayer.forceLockRotation = false;
        
        // Reset weapon state
        this.localPlayer.isAiming = false;
        this.localPlayer.isReloading = false;
        this.localPlayer.isShooting = false;
        
        // Set bullets and health from server message
        this.localPlayer.health = message.health || 100;
        this.localPlayer.bullets = message.bullets || this.localPlayer.maxBullets || 6;
        
        // Reset any original movement methods that might have been backed up
        if (this.localPlayer._origMove) {
            console.log('[QuickDraw] Restoring original move method');
            this.localPlayer.move = this.localPlayer._origMove;
            this.localPlayer._origMove = null;
        }
        
        // Disable aerial camera completely
        this.disableAerialCamera();
        
        // Ensure the player camera is the active camera
        if (this.scene && this.scene.renderer) {
            this.scene.renderer.overrideCamera = null;
            this.scene.renderer.camera = this.localPlayer.camera;
        }
        
        // Reset all quickdraw state flags
        this.inDuel = false;
        this.inLobby = false;
        this.duelState = 'none';
        this.duelOpponentId = null;
        this.duelActive = false;
        this.aerialCameraPathSet = false;
        
        // Remove local player model
        this.removeLocalPlayerModel();
        
        // Reset gun and animation state
        if (this.localPlayer.viewmodel) {
            console.log('[QuickDraw] Resetting gun state');
            this.localPlayer.viewmodel.visible = true;
            
            // Reset gun position to holster
            if (this.localPlayer.currentGunOffset && this.localPlayer.holsterOffset) {
                this.localPlayer.currentGunOffset.copy(this.localPlayer.holsterOffset);
            }
            
            // Clear any ongoing gun animation
            if (this.localPlayer.gunAnimation) {
                this.localPlayer.gunAnimation.reset();
                this.localPlayer.gunAnimation = null;
            }
        }
        
        // Set player position from server message
        if (message.position) {
            // Apply the position
            this.localPlayer.group.position.set(
                message.position.x,
                message.position.y,
                message.position.z
            );
            console.log(`[QuickDraw] Player respawned at position: (${message.position.x.toFixed(2)}, ${message.position.y.toFixed(2)}, ${message.position.z.toFixed(2)})`);
            
            // Reset velocity (especially important for y velocity)
            this.localPlayer.velocity = new THREE.Vector3(0, 0, 0);
        }
        
        // Update UI
        if (typeof updateHealthUI === 'function') {
            updateHealthUI(this.localPlayer);
        }
        
        // Broadcast our full reset to other clients to ensure our model is refreshed on their end
        this.sendPlayerStateReset();
        
        console.log('[QuickDraw] Player reset and respawn complete');
    }

    /**
     * Clear all match UI elements
     */
    clearMatchUI() {
        console.log('[QuickDraw] Clearing match UI elements');
        
        // Hide message overlay
        this.hideMessage();
        
        // Hide draw circle
        if (this.drawCircle) {
            this.drawCircle.style.display = 'none';
        }
        
        // Hide status indicator
        if (this.statusIndicator) {
            this.statusIndicator.style.display = 'none';
        }
        
        // Hide health bar
        if (this.healthBarContainer) {
            this.healthBarContainer.style.display = 'none';
        }
        
        // Restore player nametags
        this.restorePlayerNametags();
    }

    /**
     * Cleanup method for use before unloading the page or resetting the game.
     * This ensures all UI elements, timers, and state are properly cleaned up.
     */
    cleanup() {
        console.log('[QuickDraw] Cleaning up QuickDraw instance');
        
        // Always restore nametags when cleaning up
        this.restorePlayerNametags();
        
        // Ensure letterbox effect is removed
        document.body.classList.remove('letterbox-active');
        
        // Clear all duel-related timers
        this.clearAllDuelTimers();
        
        // Reset player state if we have a local player
        if (this.localPlayer) {
            this.resetPlayerState();
        }
        
        // Ensure aerial camera is disabled
        this.disableAerialCamera();
        
        // Reset all state variables
        this.inDuel = false;
        this.inLobby = false;
        this.duelState = 'none';
        this.duelOpponentId = null;
        this.pendingChallenge = null;
        this.duelActive = false;
        
        // Hide UI elements
        this.hideMessage();
        if (this.statusIndicator) this.statusIndicator.style.display = 'none';
        if (this.drawCircle) this.drawCircle.style.display = 'none';
        if (this.healthBarContainer) this.healthBarContainer.style.display = 'none';
        if (this.challengePrompt) this.challengePrompt.style.display = 'none';
        
        console.log('[QuickDraw] Cleanup complete');
    }

    /**
     * Hide all player nametags during a duel
     */
    hidePlayerNametags() {
        // Check if we have access to the multiplayerManager
        if (!window.multiplayerManager) {
            console.warn('[QuickDraw] Cannot hide nametags - multiplayerManager not available');
            return;
        }
        
        console.log(`[QuickDraw] Hiding ALL nametags during quickdraw duel using global control`);
        
        // Use the new global method to disable all nametags
        window.multiplayerManager.setAllNametagsVisible(false);
    }
    
    /**
     * Restore all hidden nametags after duel
     */
    restorePlayerNametags() {
        // Check if we have access to the multiplayerManager
        if (!window.multiplayerManager) return;
        
        console.log('[QuickDraw] Restoring ALL nametags after duel using global control');
        
        // Use the new global method to enable all nametags
        window.multiplayerManager.setAllNametagsVisible(true);
    }

    /**
     * Ensures we have access to the MultiplayerManager for nametag control
     */
    ensureMultiplayerManagerAccess() {
        // Check if window.multiplayerManager is already set
        if (!window.multiplayerManager) {
            console.warn('[QuickDraw] MultiplayerManager not available yet - will retry later');
            
            // Set up a retry check after a short delay
            setTimeout(() => {
                if (!window.multiplayerManager) {
                    console.warn('[QuickDraw] MultiplayerManager still not available - nametag control will be limited');
                } else {
                    console.log('[QuickDraw] MultiplayerManager now available - nametag control enabled');
                }
            }, 2000);
        } else {
            console.log('[QuickDraw] MultiplayerManager available - nametag control enabled');
        }
    }
}