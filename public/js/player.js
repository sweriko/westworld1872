import { Viewmodel } from './viewmodel.js';
import { updateAmmoUI, updateHealthUI, showDamageIndicator } from './ui.js';
import { applyRecoil } from './effects.js';
import { networkManager } from './network.js';

/**
 * The local Player class (first-person).
 */
export class Player {
  /**
   * @param {Object} config
   * @param {THREE.Scene} config.scene
   * @param {THREE.PerspectiveCamera} config.camera
   * @param {SoundManager} config.soundManager
   * @param {Function} config.onShoot - A callback function called when the player fires a bullet.
   */
  constructor({ scene, camera, soundManager, onShoot }) {
    // Enable ammo debugging by default
    window.debugAmmo = true;
    
    this.scene = scene;
    this.camera = camera;
    this.soundManager = soundManager;
    this.onShootCallback = onShoot;

    this.group = new THREE.Group();
    
    // Start at a random spawn point in the town street
    this.spawnPlayerRandomly();
    
    this.scene.add(this.group);
    this.camera.position.set(0, -0.7, 0);
    this.group.add(this.camera);

    this.id = null; // will be set by networkManager.onInit
    this.velocity = new THREE.Vector3();
    this.canJump = false;
    this.gravity = 25; // Increased from 15 for much stronger gravity pull

    // Add recoil boost flag to prevent normal velocity dampening
    this.recoilBoosted = false;
    this.recoilBoostTime = 0;
    this.recoilBoostDuration = 0.3; // How long the velocity boost lasts

    // Movement flags
    this.moveForward = false;
    this.moveBackward = false;
    this.moveLeft = false;
    this.moveRight = false;
    
    // Movement control flags
    this.canMove = true; // Whether player can move at all
    this.forceLockMovement = false; // Complete movement override (quickdraw mode)
    this.chatActive = false; // Whether chat input is active
    
    // Sprinting flag - new addition
    this.isSprinting = false;
    this.normalSpeed = 3.5; // Reduced from 5 for slower movement
    this.sprintSpeed = 7; // Reduced from 12 for more realistic running
    this.sprintJumpBoost = 1.1; // Reduced further for more subtle sprint jumping effect

    // Aiming
    this.isAiming = false;
    this.defaultFOV = 75;
    this.aimFOV = 65;
    
    // Camera effects for sprinting - with smoothing parameters
    this.defaultCameraHeight = -0.7;
    this.bobPhase = 0; // Phase accumulator for bob effect
    this.bobIntensity = 0; // Current intensity of bobbing (interpolates)
    this.targetBobIntensity = 0; // Target bobbing intensity
    this.bobTransitionSpeed = 3; // Speed of transition to new bob intensity
    
    // Gun
    this.viewmodel = new Viewmodel();
    this.holsterOffset = new THREE.Vector3(0.6, -1.1, -0.8);
    this.aimOffset = new THREE.Vector3(0.3, -0.9, -0.5);
    this.currentGunOffset = this.holsterOffset.clone();
    
    // Add both models to camera, but we'll only show the viewmodel
    this.camera.add(this.viewmodel.group);
    
    // FOV transition smoothing
    this.currentFOV = this.defaultFOV;
    this.targetFOV = this.defaultFOV;
    this.fovTransitionSpeed = 5; // Speed of FOV transitions

    // Reload
    this.isReloading = false;
    this.reloadTime = 4000; // Changed from 2000ms to 4000ms (4 seconds)
    this.reloadProgress = 0;
    
    // Track bullets for each weapon type separately
    this.weaponAmmo = {
      revolver: 6,
      shotgun: 2
    };
    
    this.bullets = 6; // Current active weapon's bullets
    this.maxBullets = 6;
    this.canShoot = true;

    // Weapon types and switching
    this.activeWeapon = 'revolver'; // 'revolver' or 'shotgun'
    this.weaponStats = {
      revolver: {
        maxBullets: 6,
        reloadTime: 4000,
        bulletCount: 1, // Single bullet per shot
        bulletSpread: 0.0005 // Default spread
      },
      shotgun: {
        maxBullets: 2,
        reloadTime: 6000, // Longer reload for shotgun
        bulletCount: 10, // 10 pellets per shot
        bulletSpread: 0.08, // Increased spread from 0.03 to 0.08
        pelletDamage: {
          head: 10,    // Headshot damage per pellet
          body: 5,     // Body damage per pellet
          limbs: 5     // Limb damage per pellet
        }
      }
    };

    // Health
    this.health = 100;

    // Networking
    this.lastNetworkUpdate = 0;
    this.networkUpdateInterval = 33; // ~30 fps updates, balanced between responsiveness and bandwidth

    // Quick Draw mode
    this.canAim = true; // Whether the player is allowed to aim (used by Quick Draw)
    
    // Alternative aiming controls
    this.isFAiming = false; // Whether player is aiming using the F key
    this.isFRmbPressed = false; // Whether right mouse button is pressed during F-aiming
    this.isLmbPressed = false; // Whether left mouse button is being held (for hold-to-shoot)
    
    // Store previous position to detect collision with arena boundary
    this.previousPosition = new THREE.Vector3();

    // Quick Draw lobby information
    this.quickDrawLobbyIndex = -1; // -1 means not in a lobby
    
    // Anti-cheat: Server reconciliation
    this.serverPosition = new THREE.Vector3();
    this.isReconciling = false;
    this.reconciliationLerpFactor = 0.3; // How quickly to move to server position

    // Footstep sound system
    this.lastFootstepTime = 0; // Time of last footstep sound
    this.footstepInterval = 0.5; // Base interval in seconds between steps
    this.isLeftFoot = true; // Track which foot is next
    this.isMovingLastFrame = false; // Track if player was moving in the last frame
    this.isJumping = false; // Track jumping state
    
    // Hit zones for damage calculations
    this.hitZones = {
      head: { damage: 100 },
      body: { damage: 40 },
      limbs: { damage: 20 }
    };
    
    // Jump mechanics
    this.jumpCooldown = 0; // Cooldown timer to prevent jump spamming
    this.jumpCooldownTime = 0.3; // Time in seconds between allowed jumps
    
    // Initialize network & UI
    this.initNetworking();
    updateAmmoUI(this);
    updateHealthUI(this);
  }

  /**
   * Spawn the player at a random position along the main street
   */
  spawnPlayerRandomly() {
    // Try to find a valid spawn position with no collisions
    let spawnX, spawnY, spawnZ;
    let validSpawn = false;
    let attempts = 0;
    const maxAttempts = 20;
    
    while (!validSpawn && attempts < maxAttempts) {
      // Random position within the main street
      spawnX = (Math.random() - 0.5) * 10; // Random X between -5 and 5 (main street)
      spawnY = 2.72; // Eye level
      spawnZ = (Math.random() - 0.5) * 40; // Random Z between -20 and 20
      
      // Check if this position is valid (not colliding with anything)
      const testPosition = new THREE.Vector3(spawnX, spawnY, spawnZ);
      validSpawn = this.checkBoundaryCollision(testPosition);
      attempts++;
    }
    
    // If we couldn't find a valid position, use a safe fallback position
    if (!validSpawn) {
      console.warn(`Could not find valid spawn position after ${maxAttempts} attempts. Using fallback.`);
      spawnX = 0;
      spawnY = 2.72; // Consistent eye level
      spawnZ = 0;
    }

    this.group.position.set(spawnX, spawnY, spawnZ);
    
    // Random rotation (facing any direction)
    this.group.rotation.y = Math.random() * Math.PI * 2;
    
    console.log(`Player spawned at: X=${spawnX.toFixed(2)}, Z=${spawnZ.toFixed(2)}`);
  }

  /**
   * Initialize networking for the player
   */
  initNetworking() {
    // Start the WebSocket
    networkManager.connect();

    networkManager.onInit = (initData) => {
      this.id = initData.id;
      console.log(`Local player initialized with ID: ${this.id}`);
    };
    
    // Handle player hit
    networkManager.onPlayerHit = (sourceId, hitData, newHealth, hitZone) => {
      this.health = newHealth;
      updateHealthUI(this);
      
      // Show hit zone on screen for 100ms
      showDamageIndicator(hitData.damage, hitZone);
    };
    
    // Anti-cheat: Handle respawn from server
    networkManager.onRespawn = (position, health, bullets, maxBullets, activeWeapon) => {
      console.log("Server-initiated respawn");
      
      // Set position
      this.group.position.copy(position);
      this.previousPosition.copy(position);
      
      // Update health
      this.health = health || 100;
      
      // Set active weapon if provided by server
      if (activeWeapon && (activeWeapon === 'revolver' || activeWeapon === 'shotgun')) {
        // Only switch if different from current
        if (this.activeWeapon !== activeWeapon) {
          this.switchWeapon(activeWeapon);
        }
      }
      
      // Reset all weapon ammo to maximum
      this.weaponAmmo = {
        revolver: this.weaponStats.revolver.maxBullets,
        shotgun: this.weaponStats.shotgun.maxBullets
      };
      
      // Set active weapon's bullets
      this.bullets = this.weaponAmmo[this.activeWeapon];
      this.maxBullets = this.weaponStats[this.activeWeapon].maxBullets;
      
      // Cancel any ongoing reloading
      if (this.isReloading) {
        // Cancel reload animation
        if (this.viewmodel) {
          this.viewmodel.cancelReload();
        }
        
        // Hide reload UI elements
        const reloadProgressContainer = document.getElementById('reload-progress-container');
        if (reloadProgressContainer) reloadProgressContainer.style.display = 'none';
      }
      
      // Reset states
      this.isReloading = false;
      this.isAiming = false;
      this.velocity.y = 0;
      this.canAim = true;
      this.canShoot = true;
      
      // Update UI
      updateHealthUI(this);
      updateAmmoUI(this);
      
      console.log(`Respawn complete - Current weapon: ${this.activeWeapon}, Ammo: ${this.bullets}/${this.maxBullets}`);
      console.log(`Weapon ammo: Revolver: ${this.weaponAmmo.revolver}, Shotgun: ${this.weaponAmmo.shotgun}`);
    };
  }

  update(deltaTime) {
    // Skip update if paused
    if (window.isPaused) return;
    
    // Store the previous position for collision detection and footsteps
    this.previousPosition.copy(this.group.position);
    
    // Platform stability check - prevent falling through platforms 
    this.stabilizePlatformPosition();
    
    // Anti-cheat: Handle server reconciliation
    if (this.isReconciling) {
      // Calculate distance to server position
      const distance = this.group.position.distanceTo(this.serverPosition);
      
      // Only apply reconciliation if significant deviation exists
      if (distance > 0.1) {
        // For large corrections, blend gradually
        this.group.position.lerp(this.serverPosition, this.reconciliationLerpFactor);
      } else {
        // Close enough, stop reconciling
        this.isReconciling = false;
      }
    }
    
    // Smoothly interpolate the gun offset & FOV
    const targetOffset = this.isAiming && this.canAim ? this.aimOffset : this.holsterOffset;
    this.currentGunOffset.lerp(targetOffset, 0.1);
    
    // Update viewmodel animation - Ensure this is being called!
    if (this.viewmodel) {
      this.viewmodel.update(deltaTime);
    } else {
      console.warn("Viewmodel is not initialized!");
    }

    // Adjust FOV based on sprinting and aiming with smoother transitions
    if (this.isAiming && this.canAim) {
      this.targetFOV = this.aimFOV;
    } else if (this.isSprinting && this.isMoving() && !window.quickDraw?.inDuel) {
      // FOV effect when sprinting, but not in QuickDraw duel
      this.targetFOV = this.defaultFOV + 7; // Less extreme FOV increase (was 10)
    } else {
      this.targetFOV = this.defaultFOV;
    }
    
    // Smooth FOV transition
    this.currentFOV = THREE.MathUtils.lerp(
      this.currentFOV, 
      this.targetFOV, 
      deltaTime * this.fovTransitionSpeed
    );
    
    // Only update camera FOV if it has changed enough to be noticeable
    if (Math.abs(this.camera.fov - this.currentFOV) > 0.01) {
      this.camera.fov = this.currentFOV;
      this.camera.updateProjectionMatrix();
    }

    // Process movement
    this.move(deltaTime);
    
    // Footstep sounds logic based on movement
    const positionBeforeMovement = this.previousPosition.clone();
    
    // Check for nearest player for potential quickdraw on mobile
    if (window.mobileControls && typeof window.checkNearestPlayerForQuickdraw === 'function') {
      const nearbyPlayer = window.checkNearestPlayerForQuickdraw(this);
      // Update mobile UI if nearby player found
      if (window.mobileControls) {
        window.mobileControls.checkForNearbyPlayers(nearbyPlayer !== null);
      }
    }
    
    // Update camera bob (only if on ground)
    // Always update the head bob regardless of whether we're on ground
    this.updateHeadBob(deltaTime);
    
    // Update aiming effects including crosshair
    this.updateAiming(deltaTime);
    
    // Update footstep sounds based on movement
    this.updateFootstepSounds(deltaTime, positionBeforeMovement);
    
    // Send periodic network updates
    const now = performance.now();
    if (now - this.lastNetworkUpdate > this.networkUpdateInterval) {
      this.lastNetworkUpdate = now;
      this.sendNetworkUpdate();
    }

    if (this.soundManager) {
      // Update audio listener position to follow the player's camera
      // Use precise camera position rather than group position for better audio
      const cameraPosition = new THREE.Vector3();
      this.camera.getWorldPosition(cameraPosition);
      
      // Get forward direction vector from camera
      const cameraDirection = new THREE.Vector3(0, 0, -1);
      cameraDirection.applyQuaternion(this.camera.quaternion);
      
      // Get up vector from camera
      const upVector = new THREE.Vector3(0, 1, 0);
      upVector.applyQuaternion(this.camera.quaternion);
      
      // Update the audio listener position
      this.soundManager.updateListenerPosition(cameraPosition, cameraDirection, upVector);
    }
  }

  /**
   * Process player movement based on input - can be overridden to disable movement
   * @param {number} deltaTime - Time elapsed since last frame
   */
  move(deltaTime) {
    if (this.forceLockMovement) return; // Complete override for duel mode
    if (!this.canMove) return; // Movement lock (e.g. during Quick Draw)
    if (this.chatActive) return; // Don't move when chat is active

    // Update jump cooldown if it's active
    if (this.jumpCooldown > 0) {
      this.jumpCooldown = Math.max(0, this.jumpCooldown - deltaTime);
    }
    
    // Update recoil boost timer if active
    if (this.recoilBoosted) {
      this.recoilBoostTime -= deltaTime;
      if (this.recoilBoostTime <= 0) {
        this.recoilBoosted = false;
      }
    }

    // Only apply movement inputs if not in recoil boost mode
    if (!this.recoilBoosted) {
      if (this.moveForward) this.velocity.z = -this.getMoveSpeed();
      else if (this.moveBackward) this.velocity.z = this.getMoveSpeed();
      else this.velocity.z = 0;

      if (this.moveRight) this.velocity.x = this.getMoveSpeed();
      else if (this.moveLeft) this.velocity.x = -this.getMoveSpeed();
      else this.velocity.x = 0;
    }

    // Store previous position before movement for collision detection
    this.previousPosition.copy(this.group.position);

    // Store previous info for comparing changes
    const wasOnGround = this.group.position.y <= 2.72 || this.isOnObject;
    const wasJumping = this.isJumping;
    
    // Calculate new vertical position with gravity - always apply gravity unless in recoil boost
    if (!wasOnGround && (!this.recoilBoosted || this.velocity.y < 0)) {
      this.velocity.y -= this.gravity * deltaTime;
    }
    const newVerticalPos = {
      y: this.group.position.y + (this.velocity.y * deltaTime)
    };
    
    // Check if player will land on an object (like a crate)
    const feetPos = new THREE.Vector3(
      this.group.position.x,
      this.group.position.y - 2.72, // Adjust for player height
      this.group.position.z
    );
    const isOnObject = this.checkStandingOnObject(feetPos);
    
    // Get terrain height at current position
    let terrainHeight = 0;
    if (window.physics) {
      terrainHeight = window.physics.getTerrainHeightAt(this.group.position.x, this.group.position.z);
    }
    
    // Check if player would hit a ceiling
    const headPos = new THREE.Vector3(
      this.group.position.x,
      this.group.position.y + 0.3, // Adjust for player height
      this.group.position.z
    );
    const hitCeiling = this.checkCeilingCollision(headPos);
    
    // Handle vertical movement
    if (this.velocity.y <= 0 && (newVerticalPos.y <= 2.72 + terrainHeight || isOnObject)) {
      // Player landed on ground or object
      if (this.velocity.y < -3 && !wasOnGround) {
        // Play landing sound if falling fast enough
        if (this.soundManager) {
          this.soundManager.playSound("jumpland", 0, 1.2);
        }
      }
      
      // Set to ground or object height
      if (isOnObject && isOnObject.y > 2.72 + terrainHeight) {
        this.group.position.y = isOnObject.y;
      } else {
        this.group.position.y = 2.72 + terrainHeight; // Regular ground level + terrain
      }
      
      this.velocity.y = 0;
      this.canJump = true;
      this.isJumping = false;
    } else if (hitCeiling && this.velocity.y > 0) {
      // Hit ceiling, stop upward momentum
      this.velocity.y = 0;
      this.group.position.y = hitCeiling.y - 0.3; // Adjust position to be just below ceiling
    } else {
      // In air, apply vertical motion
      this.group.position.y = newVerticalPos.y;
      this.canJump = false;
    }
    
    // Apply horizontal movement to a test position (don't actually move yet)
    const movement = new THREE.Vector3();
    
    // Special handling for recoil boost - use absolute world direction
    if (this.recoilBoosted) {
      // For recoil, we use the velocity directly as world-space movement
      movement.x = this.velocity.x * deltaTime;
      movement.z = this.velocity.z * deltaTime;
    } else {
      // Normal movement - apply player rotation
      movement.x = this.velocity.x * deltaTime;
      movement.z = this.velocity.z * deltaTime;
      movement.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.group.rotation.y);
    }
    
    // Calculate desired new position
    const newPosition = this.group.position.clone().add(movement);
    
    // Auto-step detection - check if there's a small step in front of us that we can climb
    const stepHeight = 0.9;
    const stepPosition = this.checkForStep(newPosition, stepHeight);
    if (stepPosition) {
      // Found a step we can climb - adjust our position to step up onto it
      // Smooth the transition by interpolating current height and target height
      const stepUpLerpFactor = 0.5; // Controls how quickly we step up
      this.group.position.y = THREE.MathUtils.lerp(
        this.group.position.y,
        stepPosition.y,
        stepUpLerpFactor
      );
      this.velocity.y = 0; // Reset vertical velocity
      this.canJump = true; // Always can jump on top of a step
      this.isJumping = false;
    }
    
    // Use our enhanced collision system with sliding
    const finalPosition = this.handleCollisionSliding(newPosition);
    
    // Apply the horizontal position
    this.group.position.x = finalPosition.x;
    this.group.position.z = finalPosition.z;
    
    // We no longer need to handle jump sound here since it's handled in the jump() method
  }

  /**
   * Update footstep sounds based on movement
   * @param {number} deltaTime - Time elapsed since last frame
   * @param {THREE.Vector3} previousPosition - Position before movement this frame
   */
  updateFootstepSounds(deltaTime, previousPosition) {
    // Only play footstep sounds if we're on the ground and actually moving
    const isMovingNow = this.isMoving() && this.canJump;
    
    // Calculate how far we've moved this frame
    const distanceMoved = this.group.position.distanceTo(previousPosition);
    
    // Skip if not moving or not on ground
    if (!isMovingNow || distanceMoved < 0.001) {
      this.isMovingLastFrame = false;
      return;
    }
    
    // Calculate the appropriate footstep interval based on speed
    let currentInterval = this.footstepInterval;
    if (this.isSprinting) {
      currentInterval = 0.3; // Faster steps when sprinting
    } else {
      currentInterval = 0.5; // Normal walking pace
    }
    
    // Accumulate time since last footstep
    this.lastFootstepTime += deltaTime;
    
    // Check if it's time for a footstep sound
    if (this.lastFootstepTime >= currentInterval) {
      // Reset the timer, with a small random variation for naturalness
      this.lastFootstepTime = -0.05 + Math.random() * 0.1;
      
      // Determine which foot and play the appropriate sound
      if (this.soundManager) {
        // Use direct sound play instead of positional audio for now
        this.soundManager.playSound(
          this.isLeftFoot ? 'leftstep' : 'rightstep',
          0, // No cooldown
          this.isSprinting ? 1.2 : 0.8 // Adjust volume based on speed
        );
        
        // Try positional audio as fallback
        try {
          this.soundManager.playSoundAt(
            this.isLeftFoot ? 'leftstep' : 'rightstep',
            this.group.position,
            0, // No cooldown
            this.isSprinting ? 1.2 : 0.8 // Adjust volume based on speed
          );
        } catch (err) {
          console.log("Fallback to positional audio failed:", err);
        }
      }
      
      // Switch feet for next step
      this.isLeftFoot = !this.isLeftFoot;
    }
    
    this.isMovingLastFrame = true;
  }

  /**
   * Updates camera head bobbing effect for walking/running with much smoother transitions
   * @param {number} deltaTime - Time elapsed since last frame
   */
  updateHeadBob(deltaTime) {
    // Update target bobbing intensity based on movement
    if (this.isMoving() && this.canJump) {
      // Very subtle bobbing values for higher camera position
      this.targetBobIntensity = this.isSprinting ? 0.022 : 0.011;
    } else {
      this.targetBobIntensity = 0;
    }
    
    // Smoothly transition bob intensity
    this.bobIntensity = THREE.MathUtils.lerp(
      this.bobIntensity,
      this.targetBobIntensity,
      Math.min(1, deltaTime * this.bobTransitionSpeed)
    );
    
    // Only calculate bob if intensity is significant
    if (this.bobIntensity > 0.001) {
      // Update phase at a speed proportional to movement
      // Use different frequencies for vertical and horizontal to create more natural movement
      this.bobPhase += deltaTime * (this.isSprinting ? 10 : 6);
      
      // Calculate vertical and horizontal components
      const verticalBob = Math.sin(this.bobPhase * 2) * this.bobIntensity;
      // Much smaller horizontal component
      const horizontalBob = Math.cos(this.bobPhase) * this.bobIntensity * 0.3;
      
      // Apply to camera position smoothly - ensure we're using defaultCameraHeight
      this.camera.position.y = THREE.MathUtils.lerp(
        this.camera.position.y,
        this.defaultCameraHeight + verticalBob,
        Math.min(1, deltaTime * 8)
      );
      
      // Extremely subtle horizontal movement
      this.camera.position.x = THREE.MathUtils.lerp(
        this.camera.position.x,
        horizontalBob,
        Math.min(1, deltaTime * 3)
      );
    } else {
      // Smoothly return to default position when not moving
      this.camera.position.y = THREE.MathUtils.lerp(
        this.camera.position.y,
        this.defaultCameraHeight,
        Math.min(1, deltaTime * 4)
      );
      
      this.camera.position.x = THREE.MathUtils.lerp(
        this.camera.position.x,
        0,
        Math.min(1, deltaTime * 3)
      );
    }
  }

  /**
   * Returns the current movement speed based on sprint state and location
   * @returns {number} The current movement speed
   */
  getMoveSpeed() {
    // Disable sprinting in QuickDraw duels
    if (window.quickDraw && window.quickDraw.inDuel) {
      return this.normalSpeed;
    }
    
    // Apply sprint speed if sprint key is pressed
    return this.isSprinting ? this.sprintSpeed : this.normalSpeed;
  }
  
  /**
   * Checks if the player is currently moving
   * @returns {boolean} True if any movement key is pressed
   */
  isMoving() {
    return this.moveForward || this.moveBackward || this.moveLeft || this.moveRight;
  }

  /**
   * Checks for collision with the arena boundary or town objects
   * @param {THREE.Vector3} position - The position to check
   * @returns {boolean} - true if no collision, false if colliding
   */
  checkBoundaryCollision(position) {
    // First check arena boundary if player is in a quickDraw arena
    if (this.quickDrawLobbyIndex >= 0 && window.quickDraw && window.quickDraw.physics) {
      const physics = window.quickDraw.physics;
      const arenaIndex = this.quickDrawLobbyIndex;
      
      if (!physics.isPointInSpecificArenaBoundary(position, arenaIndex)) {
        return false; // Colliding with arena boundary
      }
    }
    
    // Town border limits check removed - players can now leave town
    
    // Check collision with town objects/colliders
    if (window.physics && window.physics.bodies) {
      // Create a small sphere for collision detection
      const playerRadius = 0.68; // Increased radius from 0.4 to prevent getting too close
      
      // We'll check two points - one at "shoulder" height and one at "foot" height
      // to make collisions more realistic
      const shoulderPos = new THREE.Vector3(position.x, position.y - 0.5, position.z);
      const footPos = new THREE.Vector3(position.x, position.y - 1.5, position.z);
      
      // Check each physics body that's not a player or arena boundary
      for (const body of window.physics.bodies) {
        // Skip if this is an arena boundary
        if (body.arenaBoundary) continue;
        
        // Skip if mass > 0 (non-static body)
        if (body.mass > 0) continue;
        
        // Currently we only handle box shapes
        for (let i = 0; i < body.shapes.length; i++) {
          const shape = body.shapes[i];
          if (shape.type !== CANNON.Shape.types.BOX) continue;
          
          // Get the world position/rotation of this shape
          const shapePos = new CANNON.Vec3();
          const shapeQuat = new CANNON.Quaternion();
          body.pointToWorldFrame(body.shapeOffsets[i], shapePos);
          body.quaternion.mult(body.shapeOrientations[i], shapeQuat);
          
          // Convert to THREE.js objects for easier collision check
          const boxPos = new THREE.Vector3(shapePos.x, shapePos.y, shapePos.z);
          const boxSize = new THREE.Vector3(
            shape.halfExtents.x * 2,
            shape.halfExtents.y * 2,
            shape.halfExtents.z * 2
          );
          
          // Create box3 from position and size
          const box = new THREE.Box3().setFromCenterAndSize(boxPos, boxSize);
          
          // Skip floor-like objects for horizontal collision (if player is above them)
          // This helps with standing on roofs and floors
          if (boxSize.y < 1.0 && position.y > boxPos.y + boxSize.y/2 + 0.1) {
            // This is a thin box below the player - likely a floor, skip horizontal collision
            continue;
          }
          
          // Skip ceiling-like objects for horizontal collision (if player is below them)
          if (boxSize.y < 1.0 && position.y < boxPos.y - boxSize.y/2 - 0.1) {
            // This is a thin box above the player - likely a ceiling, skip horizontal collision
            continue;
          }
          
          // Check if player sphere intersects with box
          const distShoulder = box.distanceToPoint(shoulderPos);
          const distFoot = box.distanceToPoint(footPos);
          
          if (distShoulder < playerRadius || distFoot < playerRadius) {
            return false; // Collision detected
          }
        }
      }
    }
    
    return true; // No collision
  }
  
  /**
   * Handles sliding along walls when colliding
   * @param {THREE.Vector3} desiredPosition - Where player wants to move
   * @returns {THREE.Vector3} - Adjusted position with sliding if needed
   */
  handleCollisionSliding(desiredPosition) {
    // If no collision, return the desired position
    if (this.checkBoundaryCollision(desiredPosition)) {
      return desiredPosition;
    }
    
    // We have a collision, try to slide along the obstacle
    const currentPos = this.group.position.clone();
    
    // Calculate movement vector
    const movement = desiredPosition.clone().sub(currentPos);
    
    // If movement is very small, just return current position to avoid getting stuck
    if (movement.lengthSq() < 0.0001) {
      return currentPos;
    }
    
    // Scale down movement vector to find a non-colliding position
    const scaledMovement = movement.clone();
    let validPosition = false;
    
    // Try sliding along X and Z separately
    const slideX = currentPos.clone();
    slideX.x += movement.x;
    
    const slideZ = currentPos.clone();
    slideZ.z += movement.z;
    
    // Check if either sliding direction is valid
    const canSlideX = this.checkBoundaryCollision(slideX);
    const canSlideZ = this.checkBoundaryCollision(slideZ);
    
    if (canSlideX) {
      // X-axis movement is valid
      return slideX;
    } else if (canSlideZ) {
      // Z-axis movement is valid
      return slideZ;
    }
    
    // If we're really stuck, check if we're penetrating a collider and try to push out
    const escapeDist = 0.05; // Small escape distance
    
    // Try escaping in each cardinal direction
    const escapeVectors = [
      new THREE.Vector3(escapeDist, 0, 0),
      new THREE.Vector3(-escapeDist, 0, 0),
      new THREE.Vector3(0, 0, escapeDist),
      new THREE.Vector3(0, 0, -escapeDist)
    ];
    
    for (const escapeVec of escapeVectors) {
      const escapePos = currentPos.clone().add(escapeVec);
      if (this.checkBoundaryCollision(escapePos)) {
        console.log("Rescued player from being stuck");
        return escapePos;
      }
    }
    
    // If all else fails, return current position
    return currentPos;
  }

  /**
   * Send position/rotation updates to the server.
   */
  sendNetworkUpdate() {
    if (this.id == null) return;
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);

    networkManager.sendUpdate({
      position: {
        x: this.group.position.x,
        y: this.group.position.y,
        z: this.group.position.z
      },
      rotation: {
        y: this.group.rotation.y
      },
      isAiming: this.isAiming,
      isReloading: this.isReloading,
      isSprinting: this.isSprinting,
      isShooting: this.viewmodel && this.viewmodel.animationState === 'shoot',
      health: this.health,
      quickDrawLobbyIndex: this.quickDrawLobbyIndex
    });
  }

  /**
   * Handle shooting logic
   */
  shoot() {
    if (this.bullets <= 0 || !this.canShoot || this.isReloading) {
      // No bullets or can't shoot
      if (this.bullets === 0) {
        const reloadMessage = document.getElementById('reload-message');
        if (reloadMessage) reloadMessage.style.display = 'block';
        
        // If we're already in the empty animation, don't trigger it again
        if (this.viewmodel && 
            this.viewmodel.animationState !== `${this.activeWeapon}empty`) {
          // Play the empty gun animation when no ammo
          if (this.isAiming && this.viewmodel) {
            this.viewmodel.playFakeShootAnim();
            
            // Play empty gun click sound if sound manager exists
            if (this.soundManager && !window.isMobile) {
              // Only play empty click on desktop - skip on mobile to avoid sound issues
              if (this.activeWeapon === 'shotgun') {
                this.soundManager.playSound("shotgunempty");
              }
            }
          }
        }
      }
      return;
    }
    
    // Actually shoot
    this.bullets--;
    
    // Update weapon-specific ammo storage and ensure consistency
    this._syncWeaponAmmo();
    
    updateAmmoUI(this);

    this.canShoot = false;
    setTimeout(() => { this.canShoot = true; }, 250);

    // Play the shooting animation on the viewmodel if aiming
    if (this.isAiming) {
      this.viewmodel.playShootAnim();
    }

    // Find bullet spawn - use viewmodel instead of revolver
    const bulletStart = this.viewmodel.getBarrelTipWorldPosition();
    
    // Get weapon stats for spread and bullet count
    const weaponStats = this.weaponStats[this.activeWeapon];
    
    // Play the appropriate gunshot sound
    if (this.soundManager) {
      // Set a specific sound name based on weapon type
      const soundName = this.activeWeapon === 'shotgun' ? "shotgunshot" : "shot";
      
      // Play the sound (let the sound manager handle cooldowns internally)
      this.soundManager.playSound(soundName, 100, 0.8);
    }
    
    // For shotgun, create multiple pellets with spread
    for (let i = 0; i < weaponStats.bulletCount; i++) {
      const shootDir = new THREE.Vector3();
      this.camera.getWorldDirection(shootDir);
      
      // Apply spread - more spread for shotgun, less for revolver
      const spread = weaponStats.bulletSpread;
      shootDir.x += (Math.random() - 0.5) * spread;
      shootDir.y += (Math.random() - 0.5) * spread;
      shootDir.z += (Math.random() - 0.5) * spread;
      
      shootDir.normalize();
      
      // Call the callback to spawn bullet in main.js
      if (typeof this.onShootCallback === 'function') {
        this.onShootCallback(bulletStart, shootDir);
      }
    }

    // Recoil effect - stronger for shotgun
    const recoilMultiplier = this.activeWeapon === 'shotgun' ? 2.5 : 1.0;
    applyRecoil(this, recoilMultiplier);
    
    // If out of bullets, show reload hint
    if (this.bullets === 0) {
      const reloadMessage = document.getElementById('reload-message');
      if (reloadMessage) {
        reloadMessage.style.display = 'block';
      }
    }
  }

  /**
   * Called when the player takes damage.
   * @param {number} amount - Damage amount.
   * @param {string} hitZone - Hit zone ('head', 'body', 'limbs')
   */
  takeDamage(amount, hitZone) {
    const previousHealth = this.health;
    this.health = Math.max(this.health - amount, 0);
    console.log(`Player ${this.id} took ${amount} damage in the ${hitZone || 'body'}. Health is now ${this.health}`);
    
    // Show damage indicator with damage amount and hit zone
    if (typeof window.showDamageIndicator === 'function') {
      window.showDamageIndicator(amount, hitZone);
    }
    
    // Update health UI
    updateHealthUI(this);
    
    // Add screen flash effect based on damage amount
    this.showDamageEffect(amount);
    
    // If health reached zero, handle death
    if (previousHealth > 0 && this.health === 0) {
      console.log('Game Over');
      // Respawn after a delay
      setTimeout(() => {
        this.respawn();
      }, 1500);
    }
  }

  /**
   * Shows a screen flash effect when taking damage
   * @param {number} amount - The damage amount
   */
  showDamageEffect(amount) {
    // Create a full-screen flash effect
    const flash = document.createElement('div');
    flash.style.position = 'absolute';
    flash.style.top = '0';
    flash.style.left = '0';
    flash.style.width = '100%';
    flash.style.height = '100%';
    flash.style.backgroundColor = 'rgba(255, 0, 0, 0.3)';
    flash.style.opacity = '0';
    flash.style.transition = 'opacity 0.1s ease-in, opacity 0.4s ease-out';
    flash.style.pointerEvents = 'none';
    flash.style.zIndex = '900';
    document.getElementById('game-container').appendChild(flash);
    
    // Adjust intensity based on damage
    const intensity = Math.min(amount / 100, 0.8);
    flash.style.backgroundColor = `rgba(255, 0, 0, ${intensity})`;
    
    // Show and fade out
    setTimeout(() => {
      flash.style.opacity = '1';
      setTimeout(() => {
        flash.style.opacity = '0';
        setTimeout(() => {
          if (flash.parentNode) {
            flash.parentNode.removeChild(flash);
          }
        }, 400);
      }, 100);
    }, 0);
  }

  /**
   * Respawn the player after death
   */
  respawn() {
    // Reset health
    this.health = 100;
    updateHealthUI(this);
    
    // Spawn at a random position
    this.spawnPlayerRandomly();
    
    // Reset weapon state
    // Reset ammo for all weapons to their maximum values
    this.weaponAmmo = {
      revolver: this.weaponStats.revolver.maxBullets,
      shotgun: this.weaponStats.shotgun.maxBullets
    };
    
    // Set active weapon's bullets
    this.bullets = this.weaponAmmo[this.activeWeapon];
    this.maxBullets = this.weaponStats[this.activeWeapon].maxBullets;
    
    // Reset animation and interaction states
    this.isReloading = false;
    this.isAiming = false;
    this.velocity.y = 0;
    this.canAim = true;
    
    // Make sure UI is updated
    updateAmmoUI(this);
    
    // Reset vertical velocity
    this.velocity.y = 0;
    
    // Reset Quick Draw lobby information
    this.quickDrawLobbyIndex = -1;
    
    console.log('Player respawned');
    console.log(`Weapon ammo reset - Revolver: ${this.weaponAmmo.revolver}, Shotgun: ${this.weaponAmmo.shotgun}`);
  }

  /**
   * Start the reload process
   */
  startReload() {
    if (this.isReloading || this.bullets >= this.maxBullets) return;
    
    this.isReloading = true;
    this.reloadProgress = 0;
    
    // Use the current weapon's reload time
    const reloadTime = this.weaponStats[this.activeWeapon].reloadTime;
    
    const reloadMessage = document.getElementById('reload-message');
    const reloadProgressContainer = document.getElementById('reload-progress-container');
    if (reloadMessage) reloadMessage.style.display = 'none';
    if (reloadProgressContainer) reloadProgressContainer.style.display = 'block';

    // Reset aim state tracking to ensure it's synchronized with reload
    if (this.updateAiming && typeof this.updateAiming.lastAimingState !== 'undefined') {
      this.updateAiming.lastAimingState = this.isAiming;
    }
    
    // Always make sure viewmodel is visible during reload
    if (this.viewmodel) {
      // Special handling: allow reload to interrupt empty animation
      const emptyAnimName = `${this.activeWeapon}empty`;
      if (this.viewmodel.animationState === emptyAnimName) {
        // Reset any blocking flags to ensure reload can play
        this.viewmodel.blockHolster = false;
      }
      
      this.viewmodel.group.visible = true;
      this.viewmodel.playReloadAnim();
    }
    
    // Play reload sound based on weapon type
    if (this.soundManager) {
      const soundName = this.activeWeapon === 'shotgun' ? "shotgunreloading" : "reloading";
      this.soundManager.playSound(soundName);
    }

    // Anti-cheat: Notify server about reload start
    networkManager.sendReload();
    
    // Animate the reload progress
    const startTime = performance.now();
    const updateReload = (currentTime) => {
      if (!this.isReloading) return;
      
      const elapsed = currentTime - startTime;
      this.reloadProgress = Math.min(100, (elapsed / reloadTime) * 100);
      
      const reloadProgressBar = document.getElementById('reload-progress-bar');
      if (reloadProgressBar) {
        reloadProgressBar.style.width = this.reloadProgress + '%';
      }
      
      if (elapsed < reloadTime) {
        requestAnimationFrame(updateReload);
      } else {
        this.completeReload();
      }
    };
    
    // Start reload progress animation
    requestAnimationFrame(updateReload);
    
    // Notify server about reload state
    this.sendNetworkUpdate();
  }

  /**
   * Complete the reload process
   */
  completeReload() {
    // Update bullets to max
    this.bullets = this.maxBullets;
    
    // Sync weapon ammo state
    this._syncWeaponAmmo();
    
    updateAmmoUI(this);

    const reloadProgressContainer = document.getElementById('reload-progress-container');
    const reloadProgressBar = document.getElementById('reload-progress-bar');
    if (reloadProgressContainer) reloadProgressContainer.style.display = 'none';
    if (reloadProgressBar) reloadProgressBar.style.width = '0%';
    
    this.isReloading = false;

    // After reload finishes, we don't need to do anything with animations
    // The viewmodel.playReloadAnim's onComplete already handles the transition to idle
    // Just ensure visibility is properly managed after the animation finishes
    if (this.viewmodel) {
      // Update aim state tracking to ensure aim toggle detection will work properly
      if (this.updateAiming && typeof this.updateAiming.lastAimingState !== 'undefined') {
        // Force aim state to be correctly tracked
        this.updateAiming.lastAimingState = this.isAiming;
      }
      
      // Let the animation system handle visibility
      if (!this.isAiming) {
        setTimeout(() => {
          if (!this.isAiming && this.viewmodel && !this.viewmodel.forceVisible) {
            this.viewmodel.group.visible = false;
          }
        }, 500);
      }
    }
    
    this.sendNetworkUpdate(); // let others know
  }
  
  /**
   * Set the Quick Draw lobby index for this player
   * @param {number} index - The lobby index (0-4) or -1 for none
   */
  setQuickDrawLobby(index) {
    this.quickDrawLobbyIndex = index;
    
    // Update UI indicator
    const lobbyIndicator = document.getElementById('lobby-indicator');
    if (lobbyIndicator) {
      if (index >= 0) {
        lobbyIndicator.textContent = `Arena ${index + 1}`;
        lobbyIndicator.style.display = 'block';
      } else {
        lobbyIndicator.style.display = 'none';
      }
    }
    
    // Send update to server
    this.sendNetworkUpdate();
  }

  /**
   * Updates aiming effects including crosshair animation
   * @param {number} deltaTime - Time elapsed since last frame
   */
  updateAiming(deltaTime) {
    // Static variable to track previous aiming state
    if (this.updateAiming.lastAimingState === undefined) {
      this.updateAiming.lastAimingState = false;
    }
    
    // Check if aiming state changed
    if (this.isAiming !== this.updateAiming.lastAimingState) {
      // State changed - handle animations
      if (this.isAiming) {
        // Starting to aim - play draw animation and show model
        this.viewmodel.group.visible = true;
        
        // In idle state (possibly after reload), always allow draw animation
        if (this.viewmodel.animationState === 'idle') {
          this.viewmodel.blockHolster = false;
          this.viewmodel.pendingHolster = false;
        }
        
        // Handle case when trying to aim during reload
        if (this.viewmodel.animationState === 'revolverreload') {
          // Don't play draw animation now, the reload onComplete will handle it
          // Just update state tracking
        } else {
          // Always play the draw animation when toggling aim for other states
          this.viewmodel.playDrawAim();
        }
      } else {
        // Stopping aim - handle holstering
        
        // If we're in draw animation, explicitly set pendingHolster to true to 
        // ensure the viewmodel knows we want to holster after draw completes
        if (this.viewmodel.animationState === 'revolverdraw') {
          this.viewmodel.pendingHolster = true;
        }
        
        // Handle case when toggling aim after reload or other animations
        // Make sure we can always holster after animations finish
        if (this.viewmodel.animationState === 'idle' || 
            this.viewmodel.animationState === 'revolveraim') {
          this.viewmodel.blockHolster = false;
          this.viewmodel.pendingHolster = false; // Reset any pending holster flag
        }
        
        // Reset any stuck flags in other states
        if (this.viewmodel.animationState === 'revolverreload' || 
            this.viewmodel.animationState === 'revolvershot' ||
            this.viewmodel.animationState === 'revolverempty') {
          this.viewmodel.pendingHolster = true;
        }
        
        // Only holster if not in a forced-visible state
        if (!this.viewmodel.blockHolster) {
          // Stopping aim - play holster animation
          this.viewmodel.playHolsterAnim();
          
          // When holster animation finishes, hide the model if needed
          const holsterDuration = this.viewmodel.actions.revolverholster._clip.duration * 1000;
          
          setTimeout(() => {
            if (!this.isAiming && !this.viewmodel.forceVisible) { 
              // Double-check we're still not aiming and not forced visible
              this.viewmodel.group.visible = false;
            }
          }, holsterDuration + 100); // Add a small buffer to ensure animation completes
        }
      }
      
      // Update the tracked state
      this.updateAiming.lastAimingState = this.isAiming;
    }
    
    // Special case: in aim state but stuck with blockHolster flag
    // This helps recover from cases where state gets out of sync after reload
    if (!this.isAiming && this.viewmodel.animationState === 'revolveraim' && 
        this.viewmodel.blockHolster) {
      // Force the blockHolster flag to false so we can holster
      this.viewmodel.blockHolster = false;
      this.viewmodel.playHolsterAnim();
    }
    
    // Always keep the gun visible if forceVisible is set
    if (this.viewmodel && this.viewmodel.forceVisible) {
      this.viewmodel.group.visible = true;
    }
    
    // Crosshair animation if aiming
    const crosshair = document.getElementById('crosshair');
    if (crosshair && this.isAiming) {
      // Add subtle size adjustment based on player movement
      const isMoving = this.isMoving();
      const movementFactor = isMoving ? 1.0 + (this.velocity.length() * 0.005) : 1.0;
      
      // Calculate scaled size based on movement (further reduced from 60 to 40)
      const size = 40 * movementFactor;
      crosshair.style.width = `${size}px`;
      crosshair.style.height = `${size}px`;
      
      // Set opacity based on movement
      const opacity = isMoving ? 0.7 : 0.8;
      
      // Update colors differently for paths and circle
      const circleColor = this.health < 30 
        ? `rgba(255, ${Math.floor(255 * (this.health/30))}, ${Math.floor(255 * (this.health/60))}, ${opacity})`
        : `rgba(255, 255, 255, ${opacity})`;
      
      // Use black for paths (arrows)
      const pathColor = `rgba(0, 0, 0, ${opacity})`;
      
      // Apply black color to all SVG paths (the arrows)
      const pathElements = crosshair.querySelectorAll('path');
      pathElements.forEach(el => {
        el.setAttribute('stroke', pathColor);
      });
      
      // Apply white color to the center dot
      const circleElement = crosshair.querySelector('circle');
      if (circleElement) {
        circleElement.setAttribute('fill', circleColor);
      }
      
      // Apply expansion animation class if not already applied
      if (!crosshair.classList.contains('expand') && !crosshair.classList.contains('expanded')) {
        crosshair.classList.add('expand');
        
        // After animation completes, mark as expanded
        setTimeout(() => {
          crosshair.classList.remove('expand');
          crosshair.classList.add('expanded');
        }, 250); // Match animation duration
      }
      
      // IMPORTANT: Don't modify transform - leave the inline style working
    }
  }

  /**
   * Checks if player is standing on an object
   * @param {THREE.Vector3} feetPosition - Position of player's feet
   * @returns {THREE.Vector3|false} The detected ground position or false
   */
  checkStandingOnObject(feetPosition) {
    // Early return if physics not initialized
    if (!window.physics || !window.physics.bodies) {
      return false;
    }
    
    // Create a ray starting slightly above feet and going down
    const rayStart = feetPosition.clone();
    rayStart.y += 0.2; // Start a bit above to ensure we detect even when slightly penetrating
    
    const rayLength = 0.4; // Detection distance
    
    // Check each physics body for ground
    for (const body of window.physics.bodies) {
      // Skip if this is an arena boundary
      if (body.arenaBoundary) continue;
      
      // Skip if mass > 0 (non-static body)
      if (body.mass > 0) continue;
      
      // Currently we only handle box shapes
      for (let i = 0; i < body.shapes.length; i++) {
        const shape = body.shapes[i];
        if (shape.type !== CANNON.Shape.types.BOX) continue;
        
        // Get the world position/rotation of this shape
        const shapePos = new CANNON.Vec3();
        body.pointToWorldFrame(body.shapeOffsets[i], shapePos);
        
        // Convert to THREE.js objects
        const boxPos = new THREE.Vector3(shapePos.x, shapePos.y, shapePos.z);
        const boxSize = new THREE.Vector3(
          shape.halfExtents.x * 2,
          shape.halfExtents.y * 2,
          shape.halfExtents.z * 2
        );
        
        // Create box3 from position and size
        const box = new THREE.Box3().setFromCenterAndSize(boxPos, boxSize);
        
        // Check if the ray intersects the box
        if (Math.abs(rayStart.x - boxPos.x) <= boxSize.x/2 + 0.5 && 
            Math.abs(rayStart.z - boxPos.z) <= boxSize.z/2 + 0.5) {
          // We're within the X-Z bounds of the box, check Y
          const topOfBox = boxPos.y + boxSize.y/2;
          
          // If the box top is between our ray start and end points
          if (topOfBox <= rayStart.y && topOfBox >= rayStart.y - rayLength) {
            // Return the position with the adjusted y-coordinate
            return new THREE.Vector3(rayStart.x, topOfBox + 2.72, rayStart.z);
          }
        }
      }
    }
    
    return false;
  }
  
  /**
   * Checks if player's head is hitting a ceiling
   * @param {THREE.Vector3} headPosition - Position of player's head
   * @returns {THREE.Vector3|false} The detected ceiling position or false
   */
  checkCeilingCollision(headPosition) {
    // Early return if physics not initialized
    if (!window.physics || !window.physics.bodies) {
      return false;
    }
    
    // Create a ray starting at head and going up
    const rayStart = headPosition.clone();
    const rayLength = 0.3; // Detection distance
    
    // Check each physics body for ceiling
    for (const body of window.physics.bodies) {
      // Skip if this is an arena boundary
      if (body.arenaBoundary) continue;
      
      // Skip if mass > 0 (non-static body)
      if (body.mass > 0) continue;
      
      // Currently we only handle box shapes
      for (let i = 0; i < body.shapes.length; i++) {
        const shape = body.shapes[i];
        if (shape.type !== CANNON.Shape.types.BOX) continue;
        
        // Get the world position/rotation of this shape
        const shapePos = new CANNON.Vec3();
        const shapeQuat = new CANNON.Quaternion();
        body.pointToWorldFrame(body.shapeOffsets[i], shapePos);
        body.quaternion.mult(body.shapeOrientations[i], shapeQuat);
        
        // Convert to THREE.js objects
        const boxPos = new THREE.Vector3(shapePos.x, shapePos.y, shapePos.z);
        const boxSize = new THREE.Vector3(
          shape.halfExtents.x * 2,
          shape.halfExtents.y * 2,
          shape.halfExtents.z * 2
        );
        
        // Create box3 from position and size
        const box = new THREE.Box3().setFromCenterAndSize(boxPos, boxSize);
        
        // Check if the ray intersects the box
        if (Math.abs(rayStart.x - boxPos.x) <= boxSize.x/2 + 0.5 && 
            Math.abs(rayStart.z - boxPos.z) <= boxSize.z/2 + 0.5) {
          // We're within the X-Z bounds of the box, check Y
          const bottomOfBox = boxPos.y - boxSize.y/2;
          
          // If the box bottom is between our ray start and end points
          if (bottomOfBox >= rayStart.y && bottomOfBox <= rayStart.y + rayLength) {
            // Return the position with the adjusted y-coordinate
            return new THREE.Vector3(rayStart.x, bottomOfBox, rayStart.z);
          }
        }
      }
    }
    
    return false;
  }

  /**
   * Prevents the player from falling through platforms by performing additional checks
   */
  stabilizePlatformPosition() {
    // If we're on the ground or jumping, no need for stabilization
    if (this.canJump || this.velocity.y > 0) return;
    
    // Cast a ray directly below the player to detect platforms we might be falling through
    const feetPos = new THREE.Vector3(
      this.group.position.x,
      this.group.position.y - 2.62, // Slightly higher than feet for early detection
      this.group.position.z
    );
    
    // Check if there's an object below
    const platformBelow = this.checkDirectlyBelow(feetPos, 1.0);
    
    // If we found a platform and we're falling, snap to it
    if (platformBelow && this.velocity.y < 0) {
      this.group.position.y = platformBelow.y;
      this.velocity.y = -0.01; // Very small downward force
      this.canJump = true;
      this.isJumping = false;
    }
  }
  
  /**
   * Checks for a platform directly below the player with a short ray
   * @param {THREE.Vector3} position - Starting position for ray
   * @param {number} maxDistance - Maximum distance to check below
   * @returns {THREE.Vector3|false} Position on top of platform or false
   */
  checkDirectlyBelow(position, maxDistance) {
    // Early return if physics not initialized
    if (!window.physics) return false;
    
    // Get all physics bodies
    const bodies = window.physics.bodies;
    
    // Check each physics body
    for (const body of bodies) {
      // Skip irrelevant bodies
      if (body.isGround || body.arenaBoundary || body.mass > 0) continue;
      
      // Check each shape
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
        
        // Check if we're above the box horizontally (with margin)
        const margin = 0.6; // Wide margin for safety
        if (Math.abs(position.x - boxPos.x) <= boxSize.x/2 + margin && 
            Math.abs(position.z - boxPos.z) <= boxSize.z/2 + margin) {
          
          // Get top of box
          const topOfBox = boxPos.y + boxSize.y/2;
          
          // If we're within maxDistance above the box
          if (position.y >= topOfBox && position.y - topOfBox <= maxDistance) {
            return new THREE.Vector3(this.group.position.x, topOfBox + 2.72, this.group.position.z);
          }
        }
      }
    }
    
    return false;
  }

  /**
   * Make the player jump.
   */
  jump() {
    // Don't allow jumping if on cooldown
    if (this.jumpCooldown > 0) {
      return;
    }
    
    // Double check for platforms first - ensures we can always jump on platforms
    if (!this.canJump) {
      const feetPos = new THREE.Vector3(
        this.group.position.x,
        this.group.position.y - 2.72,
        this.group.position.z
      );
      
      if (this.checkStandingOnObject(feetPos)) {
        this.canJump = true;
      }
    }
    
    if (this.canJump && !this.forceLockMovement && this.canMove) {
      // Much more realistic jump velocity (significantly reduced)
      this.velocity.y = this.isSprinting ? 5.2 * this.sprintJumpBoost : 5.2;
      this.canJump = false;
      this.isJumping = true;
      this.jumpCooldown = this.jumpCooldownTime; // Apply cooldown
      
      // Play jump sound - IMMEDIATELY with full volume
      if (this.soundManager) {
        console.log("Playing jumpup sound from jump method");
        this.soundManager.playSound("jumpup", 0, 1.5);
      }
      
      // Log for debugging
      console.log("Player jumped", this.velocity.y);
    }
  }

  /**
   * Checks if there's a small step or platform in front of the player that can be automatically climbed
   * @param {THREE.Vector3} targetPosition - The desired position to move to
   * @param {number} maxStepHeight - Maximum height difference allowed for auto-stepping
   * @returns {THREE.Vector3|false} The adjusted position with the correct height, or false
   */
  checkForStep(targetPosition, maxStepHeight) {
    // Early return if physics not initialized
    if (!window.physics) return false;
    
    // Calculate movement direction (normalized)
    const moveDir = new THREE.Vector3()
      .subVectors(targetPosition, this.group.position)
      .normalize();
    
    // Ignore if no horizontal movement
    if (Math.abs(moveDir.x) < 0.001 && Math.abs(moveDir.z) < 0.001) return false;
    
    // Cast multiple rays in the movement direction with different offsets
    const rayOffsets = [
      {x: 0, z: 0},            // Center of movement
      {x: moveDir.z*0.4, z: -moveDir.x*0.4},  // Perpendicular right
      {x: -moveDir.z*0.4, z: moveDir.x*0.4},  // Perpendicular left
      {x: moveDir.x*0.5, z: moveDir.z*0.5},   // Forward offset
      {x: moveDir.x*0.8, z: moveDir.z*0.8},   // Further forward
      {x: moveDir.x*1.0, z: moveDir.z*1.0},   // Even further forward
      {x: moveDir.x*1.2, z: moveDir.z*1.2}    // Maximum forward detection
    ];
    
    // Get all physics bodies
    const bodies = window.physics.bodies;
    
    let highestStep = null;
    let highestStepY = this.group.position.y - 10; // Start very low
    
    // Check each ray starting point
    for (const offset of rayOffsets) {
      // Create ray start position with offset
      const rayStart = new THREE.Vector3(
        targetPosition.x + offset.x, 
        this.group.position.y - 2.62, // Slightly above feet level
        targetPosition.z + offset.z
      );
      
      // Check each body with this ray
      for (const body of bodies) {
        // Skip if this is an arena boundary or moving object
        if (body.arenaBoundary || body.mass > 0) continue;
        
        // Currently we only handle box shapes
        for (let i = 0; i < body.shapes.length; i++) {
          const shape = body.shapes[i];
          if (shape.type !== CANNON.Shape.types.BOX) continue;
          
          // Get the world position/rotation of this shape
          const shapePos = new CANNON.Vec3();
          body.pointToWorldFrame(body.shapeOffsets[i], shapePos);
          
          // Convert to THREE.js objects
          const boxPos = new THREE.Vector3(shapePos.x, shapePos.y, shapePos.z);
          const boxSize = new THREE.Vector3(
            shape.halfExtents.x * 2,
            shape.halfExtents.y * 2,
            shape.halfExtents.z * 2
          );
          
          // Use much larger margin for step detection (especially for building entrances)
          const margin = 1.0; // Increased from 0.8 for better detection
          if (Math.abs(rayStart.x - boxPos.x) <= boxSize.x/2 + margin && 
              Math.abs(rayStart.z - boxPos.z) <= boxSize.z/2 + margin) {
            
            // Get the top of the box
            const topOfBox = boxPos.y + boxSize.y/2;
            
            // Check if it's a valid step height:
            // 1. The step must be higher than our current feet position
            // 2. But not too high to climb automatically
            const feetY = this.group.position.y - 2.72;
            const heightDiff = topOfBox - feetY;
            
            if (heightDiff > 0.05 && heightDiff <= maxStepHeight) {
              // Keep track of the highest valid step
              if (topOfBox > highestStepY) {
                highestStepY = topOfBox;
                highestStep = new THREE.Vector3(targetPosition.x, topOfBox + 2.72, targetPosition.z);
              }
            }
          }
        }
      }
    }
    
    // Return the highest step found, or false if none
    return highestStep;
  }

  /**
   * Syncs the weapon ammo state to ensure consistency
   * @private
   */
  _syncWeaponAmmo() {
    // Make sure weaponAmmo is initialized for all weapon types
    if (!this.weaponAmmo) {
      this.weaponAmmo = {
        revolver: this.weaponStats.revolver.maxBullets,
        shotgun: this.weaponStats.shotgun.maxBullets
      };
    }
    
    // Ensure both weapons have entries in the ammo object
    if (this.weaponAmmo.revolver === undefined) {
      this.weaponAmmo.revolver = this.weaponStats.revolver.maxBullets;
    }
    
    if (this.weaponAmmo.shotgun === undefined) {
      this.weaponAmmo.shotgun = this.weaponStats.shotgun.maxBullets;
    }
    
    // Ensure the current weapon's ammo in weaponAmmo matches bullets
    this.weaponAmmo[this.activeWeapon] = this.bullets;
    
    // Ensure max bullets is consistent with weapon stats
    this.maxBullets = this.weaponStats[this.activeWeapon].maxBullets;
    
    // Log ammo state for debugging
    if (window.debugAmmo) {
      console.log(`[AMMO] ${this.activeWeapon}: ${this.bullets}/${this.maxBullets} (Revolver: ${this.weaponAmmo.revolver}, Shotgun: ${this.weaponAmmo.shotgun})`);
    }
  }

  /**
   * Switch to a different weapon
   * @param {string} weaponType - The weapon type to switch to ('revolver' or 'shotgun')
   */
  switchWeapon(weaponType) {
    if (this.activeWeapon === weaponType || this.isReloading) {
      return; // Already using this weapon or currently reloading
    }
    
    // Force sync current weapon ammo to ensure it's saved correctly
    this._syncWeaponAmmo();
    
    // Remember previous weapon for animation transitions
    const prevWeapon = this.activeWeapon;
    
    // Log the current ammo state before switching
    if (window.debugAmmo) {
      console.log(`[SWITCH] FROM ${prevWeapon}(${this.bullets}) TO ${weaponType}(${this.weaponAmmo[weaponType]})`);
    }
    
    // Check if we're in a special animation state that might cause issues
    const currentAnimState = this.viewmodel ? this.viewmodel.animationState : 'idle';
    const isInBlockingAnimation = currentAnimState === `${prevWeapon}empty` || 
                                  currentAnimState === `${prevWeapon}shot` ||
                                  this.viewmodel.blockHolster;
    
    // Save current weapon's ammo state
    this.weaponAmmo[prevWeapon] = this.bullets;
    
    // Update weapon type
    this.activeWeapon = weaponType;
    
    // Update bullet count and max bullets based on new weapon
    this.maxBullets = this.weaponStats[weaponType].maxBullets;
    this.reloadTime = this.weaponStats[weaponType].reloadTime;
    
    // Restore the new weapon's ammo state
    this.bullets = this.weaponAmmo[weaponType];
    
    // Log the new ammo state after switching
    if (window.debugAmmo) {
      console.log(`[SWITCH] COMPLETE - Now ${this.activeWeapon} with ${this.bullets} bullets`);
    }
    
    // Update UI
    updateAmmoUI(this);
    
    // Update weapon indicators in UI
    this.updateWeaponIndicators();
    
    // Reset viewmodel animation flags if switching from a blocking animation state
    if (isInBlockingAnimation && this.viewmodel) {
      console.log(`Resetting viewmodel flags when switching from ${currentAnimState}`);
      this.viewmodel.blockHolster = false;
      this.viewmodel.pendingHolster = false;
      this.viewmodel.forceVisible = false;
      
      // Force animation state to idle to ensure clean transition
      this.viewmodel._transitionTo('idle', {
        resetTimeOnPlay: true,
        onComplete: () => {
          // After forcing idle, setup for the next animation
          if (this.isAiming) {
            // Small delay to ensure state is stable
            setTimeout(() => {
              if (this.isAiming) {
                this.viewmodel.playDrawAim();
              }
            }, 50);
          }
        }
      });
      
      // If not aiming, return early to avoid additional animation calls
      if (!this.isAiming) {
        console.log(`Switched to ${weaponType} (not aiming)`);
        return;
      }
    }
    
    // If currently aiming, transition to the new weapon's aim animation
    if (this.isAiming && this.viewmodel) {
      // If we just reset to idle, let the callback handle it
      if (isInBlockingAnimation) return;
      
      // For clean transition, first holster current weapon
      this.viewmodel.animationState = `${prevWeapon}aim`; // Force the correct state for holstering
      this.viewmodel.playHolsterAnim();
      
      // After holstering, draw new weapon
      setTimeout(() => {
        // Force viewmodel to be visible (might have been hidden during holster)
        this.viewmodel.group.visible = true;
        
        // Reset any animation state flags to ensure clean transition
        this.viewmodel.pendingHolster = false;
        this.viewmodel.blockHolster = false;
        
        // Play draw animation for new weapon
        this.viewmodel.playDrawAim();
      }, 400); // Allow slightly more time for holster animation to complete
    }
    
    console.log(`Switched to ${weaponType}`);
  }
  
  /**
   * Update the weapon indicators in the UI to match the current weapon
   */
  updateWeaponIndicators() {
    // Handle mobile UI weapon indicators
    const revolverIndicator = document.getElementById('revolver-indicator');
    const shotgunIndicator = document.getElementById('shotgun-indicator');
    
    if (revolverIndicator && shotgunIndicator) {
      if (this.activeWeapon === 'revolver') {
        revolverIndicator.className = 'weapon-indicator active';
        shotgunIndicator.className = 'weapon-indicator';
      } else {
        shotgunIndicator.className = 'weapon-indicator active';
        revolverIndicator.className = 'weapon-indicator';
      }
    }
    
    // Handle desktop UI weapon indicators
    const revolverDesktopIndicator = document.getElementById('revolver-indicator-desktop');
    const shotgunDesktopIndicator = document.getElementById('shotgun-indicator-desktop');
    
    if (revolverDesktopIndicator && shotgunDesktopIndicator) {
      if (this.activeWeapon === 'revolver') {
        revolverDesktopIndicator.className = 'desktop-weapon-indicator active';
        shotgunDesktopIndicator.className = 'desktop-weapon-indicator';
      } else {
        shotgunDesktopIndicator.className = 'desktop-weapon-indicator active';
        revolverDesktopIndicator.className = 'desktop-weapon-indicator';
      }
    }
  }
}