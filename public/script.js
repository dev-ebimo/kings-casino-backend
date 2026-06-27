// AUDIO SOUND ENGINE INITIALIZATION
const sfxClick = new Audio('audio/click.wav');
const sfxInput = new Audio('audio/input.wav');
const sfxSpin = new Audio('audio/spin-loop.mp3');
const sfxWin = new Audio('audio/win.wav');
const sfxLoss = new Audio('audio/loss.wav');
// Configure the spin loop audio to repeat naturally while velocity is high
sfxSpin.loop = true;

// Grabs reference hooks to our HTML elements using their unique ID's
const balanceValue = document.getElementById('balance-value');
const playerTag = document.getElementById('player-tag');
const resultMessage = document.getElementById('result-message');
const spinTrigger = document.getElementById('spin-trigger');
const bottleSprite = document.getElementById('bottle-sprite');

//Input synchronizers
const stakeNumber = document.getElementById('stake-number');
const stakeSlider = document.getElementById('stake-slider');

// Zone selection buttons
const btnPickUp = document.getElementById('btn-pick-up');
const btnPickDown = document.getElementById('btn-pick-down');

// Fetch our token from local storage memory instead of raw IDs
const token = localStorage.getItem('userToken');
const username = localStorage.getItem('username');

let selectedZone = null; // Stores "up" or "down"
let currentRotation = 0; // Baseline state rests perfectly flat on the dividing line
let isSpinning = false; // Mutex lock to prevent double-clicking during animations

// Defensive Guard: If there's no passport token, force them to authenticate
if (!token) {
    window.location.href = 'auth.html';
} else {
    playerTag.textContent = `${username || 'Player'}`;
}

// Synchronize: Moving the slider updates the number container
stakeSlider.addEventListener('input', (e) => {
    if (isSpinning) return;
    stakeNumber.value = e.target.value;
    // Reset playhead to zero to handle rapid clicking/dragging smoothly
    sfxInput.currentTime = 0; 
    sfxInput.play().catch(err => console.log("Audio play blocked by browser safety standard"));
});

// Synchronize: Typing a number updates the graphic slider position
stakeNumber.addEventListener('input', (e) => {
    if (isSpinning) return;
    const val = Number(e.target.value);
    if (!isNaN(val) && val >= 10 && val <= 1000) {
        stakeSlider.value = Math.floor(val);
    }
});

// Defensive Guard: Enforce bounds only when user finishes typing and changes selection
stakeNumber.addEventListener('change', (e) => {
    let val = Math.floor(Number(e.target.value));
    if (isNaN(val) || val < 10) val = 10;
    if (val > 1000) val = 1000;
    stakeNumber.value = val;
    stakeSlider.value = val;
    updateButtonLabel();
});

// Chip Click Handler: Clicking a quick bet preset chip updates inputs
document.querySelectorAll('.chip-btn').forEach(chip => {
    chip.addEventListener('click', (e) => {
        if (isSpinning) return;
        
        const preset = e.target.getAttribute('data-preset');
        if (preset) {
            stakeNumber.value = preset;
            stakeSlider.value = preset;
        } else if (e.target.id === 'btn-max-chip') {
            // MAX button rule: Automatically caps out at our layout limit
            stakeNumber.value = 1000;
            stakeSlider.value = 1000;
        }
     
        sfxClick.currentTime = 0;
        sfxClick.play().catch(err => console.log("Audio blocked"));
       // Recalculate and force update the glowing button text!
        updateButtonLabel();
    });
});

// Zone Toggle Mechanism: Toggles active UI selection states
function selectPredictionZone(zone) {
    if (isSpinning) return;

    selectedZone = zone;
    
    if (zone === 'up') {
        btnPickUp.classList.add('active');
        btnPickDown.classList.remove('active');
    } else {
        btnPickDown.classList.add('active');
        btnPickUp.classList.remove('active');
    }

    // Activate the main spin button once a zone is selected
    spinTrigger.disabled = false;
    spinTrigger.className = "main-action-btn ready";
    spinTrigger.textContent = `Spin for ₦${stakeNumber.value}!`;
}

btnPickUp.addEventListener('click', () => selectPredictionZone('up'));
btnPickDown.addEventListener('click', () => selectPredictionZone('down'));

// Dynamic text listener on stake values to keep button label updated in real-time
const updateButtonLabel = () => {
    if (selectedZone && !isSpinning) {
        spinTrigger.textContent = `Spin for ₦${stakeNumber.value}!`;
    }
};
stakeSlider.addEventListener('input', updateButtonLabel);
stakeNumber.addEventListener('input', updateButtonLabel);

spinTrigger.addEventListener('click', async () => {
    // 1. Concurrency Check: If wheel is in motion, deny execution path
    if (isSpinning || !selectedZone) return;

    const currentStake = Number(stakeNumber.value);

    isSpinning = true;
    spinTrigger.disabled = true;
    // FIRE IMMEDIATELY: Play click and kick off the rotating loop sound track

    // Start the visual click and audio spin animation anticipation loops
    sfxClick.play().catch(err => console.log("Audio blocked"));
    sfxSpin.currentTime = 0;
    sfxSpin.play().catch(err => console.log("Audio blocked"));

    spinTrigger.textContent = "Spinning...";
    resultMessage.textContent = "The bottle is losing velocity... hold on!";
    resultMessage.style.color = "#94a3b8";

    try {
        // 2. Dispatch secure handshake payload to our authenticated server
        const response = await fetch('/spin', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` // Passing your secure session token
            },
            body: JSON.stringify({
                betAmount: currentStake,
                prediction: selectedZone
            })
        });
        
        const data = await response.json();

        // ERROR GUARD: If backend rejects the play (e.g., Insufficient funds!)
        if (!response.ok) {
            // INSTANTLY KILL THE SPIN SOUND TRACK!
            sfxSpin.pause();
            sfxSpin.currentTime = 0;

            // Render the server's rejection message (e.g., "Insufficient vault funds.")
            resultMessage.textContent = data.message || "Bet rejected by server.";
            resultMessage.style.color = "#ef4444";

            // Unlock the interface controls back for the user
            isSpinning = false;
            spinTrigger.disabled = false;
            updateButtonLabel();
            return;
        }

        // 3. THE PHYSICS EQUATION: Cumulative clockwise momentum calculation
        const targetAngle = data.exactAngle; // Derived cleanly from server math (0 to 359)
        
        // Spin 5 complete circles (1800 degrees) to create high velocity blur,
        // then append the target offset degree position.
        const extraRounds = 5 * 360; 
        
        // Calculate current resting angle (0 to 359)
        const currentRestingAngle = currentRotation % 360;
        
        // Find exactly how many degrees are needed to travel forward to the target angle
        let forwardDegreesTravel = targetAngle - currentRestingAngle;
        
        // If the target angle is behind us, add 360 to force the rotation forward!
        if (forwardDegreesTravel <= 0) {
            forwardDegreesTravel += 360;
        }
        
        // Update total cumulative rotation flawlessly
        currentRotation = currentRotation + extraRounds + forwardDegreesTravel;

        // 4. Fire CSS Hardware Accelerator Matrix Transition
        bottleSprite.style.transform = `rotate(${currentRotation}deg)`;

        // 5. Intercept transition end hook (Matches our 4-second cubic-bezier CSS timer)
        setTimeout(() => {
            // INSTANTLY KILL THE SPINNING LOOP SOUND
            sfxSpin.pause();
            sfxSpin.currentTime = 0;
            // Update UI balances smoothly after bottle clicks into place
            balanceValue.textContent = Number(data.newBalance).toFixed(2);
            resultMessage.textContent = data.message;
            // Apply contextual semantic colors based on result profiles
            if (data.outcomeType === "middle") {
                resultMessage.style.color = "#f59e0b"; // Warning amber for Draw/Push
            } else if (data.isWin) {
                resultMessage.style.color = "#10b981"; // Success green for Win
                sfxWin.currentTime = 0;
                sfxWin.play().catch(err => console.log("Audio blocked"));
            } else {
                resultMessage.style.color = "#ef4444"; // Danger red for Losses
                sfxLoss.currentTime = 0;
                sfxLoss.play().catch(err => console.log("Audio blocked"));
            }

            // Relock states for next cycle play loop
            isSpinning = false;
            spinTrigger.disabled = false;
            updateButtonLabel();
        }, 4000);

    } catch (networkError) {
        // EMERGENCY CATCH: Handles complete hardware internet drops mid-spin
        sfxSpin.pause();
        sfxSpin.currentTime = 0;

        resultMessage.textContent = "Network disconnection. Server unreachable.";
        resultMessage.style.color = "#ef4444";

        // Relock states for next cycle play loop
        isSpinning = false;
        spinTrigger.disabled = false;
        updateButtonLabel();
    }
});

// 3. Create a function to fetch the real balance when the page opens
async function loadInitialBalance() {
    try {
        // Send a POST request to /balance containing the active user's ID
        const response = await fetch('/balance', {
            method: 'GET',
            headers: { 
                'Authorization': `Bearer ${token}` // Presenting our secure signed passport
            }
        });
        const data = await response.json();
        
        // Overwrite the placeholder "000" with the true database balance
        if(response.ok){
          balanceValue.textContent = Number(data.balance).toFixed(2);
        } else {
            balanceValue.textContent = "Error";
            resultMessage.textContent = data.message;
        }    
    } catch (error) {
        console.error("Could not fetch initial balance:", error);
        balanceValue.textContent = "Error";
    }
}

// Run the function immediately when the script executes
loadInitialBalance();

// PAYSTACK DEPOSIT GATEWAY CLIENT CONTROLLER
const depositTrigger = document.getElementById('deposit-trigger');
const depositAmount = document.getElementById('deposit-amount');
const depositError = document.getElementById('deposit-error');

depositTrigger.addEventListener('click', async () => {
    const amount = depositAmount.value;
    if (!amount || amount < 100) {
        depositError.textContent = "Minimum deposit allowed is ₦100.";
        return;
    }
    depositError.textContent = "";
    depositTrigger.disabled = true;
    depositTrigger.textContent = "Connecting...";

    try {
        const response = await fetch('/deposit/initialize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ amount: amount })
        });

        const data = await response.json();

        if (response.ok && data.authorization_url) {
            // REDIRECT THE USER STRAIGHT TO PAYSTACK SECURE WEB PAGE!
            window.location.href = data.authorization_url;
        } else {
            depositError.textContent = data.message || "Failed to start payment processing.";
            depositTrigger.disabled = false;
            depositTrigger.textContent = "Deposit";
        }

    } catch (error) {
        console.error("Payment pipeline execution error:", error);
        depositError.textContent = "Network disconnection. Gateway unreachable.";
        depositTrigger.disabled = false;
        depositTrigger.textContent = "Deposit";
    }
});