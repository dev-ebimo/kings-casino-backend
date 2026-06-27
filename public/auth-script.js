// PASSWORD VISIBILITY TOGGLE SYSTEM
function setupPasswordToggle(toggleId, inputId) {
    const toggleElement = document.getElementById(toggleId);
    const inputElement = document.getElementById(inputId); // Clarification: Correct! Quotes are omitted here because toggleId and inputId are local 
    // string variables passed in dynamically as parameters when invoking the function.

    if (!toggleElement || !inputElement) return;

    toggleElement.addEventListener('click', () => {
        // Look at the current type attribute and flip it back and forth
        if (inputElement.type === 'password') {
            inputElement.type = 'text';
            toggleElement.textContent = 'Hide';
        }
        else {
            inputElement.type = 'password';
            toggleElement.textContent = 'Show';
        }
    });
}

// Activate the toggle functionality for both forms safely
setupPasswordToggle('toggle-signup-pass', 'signup-password');
setupPasswordToggle('toggle-login-pass', 'login-password');

// 1. Grab reference hooks for both forms and their message slots
const signupForm = document.getElementById('signup-form');
const signupMessage = document.getElementById('signup-message');

const loginForm = document.getElementById('login-form');
const loginMessage = document.getElementById('login-message');

// 2. Handle the Sign Up submission
signupForm.addEventListener('submit', async (e) => {
    e.preventDefault(); // Stop the page from doing a default refresh on submit

    const submitBtn = signupForm.querySelector('button[type="submit"]');
    const username = document.getElementById('signup-username').value.trim();
    const password = document.getElementById('signup-password').value;

    // Mutex UI Lock: Prevent duplicate registration attempts
    submitBtn.disabled = true;
    signupMessage.textContent = "Processing registration...";
    signupMessage.style.color = "#64748b";

    try {
        // Send a secure POST request containing our form data payload
        const response = await fetch('/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }, // Explain what this does?
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();
        signupMessage.textContent = data.message;

        // Color coordinate the response text dynamically based on status codes
        if (response.ok) {
            signupMessage.style.color = "#10b981"; // Vibrant Emerald Green for success
            signupForm.reset(); // Wipe the text boxes clean
        } else {
            signupMessage.style.color = "#ef4444"; // Vivid Crimson Red for errors
        }

    } catch (error) {
        signupMessage.textContent = "Network connection error.";
        signupMessage.style.color = "#ef4444";
    } finally {
        submitBtn.disabled = false;
    }
});

// 3. Handle the Log In submission
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault(); // This stops the browser from refreshing the page when the submit button is clicked.

    const submitBtn = loginForm.querySelector('button[type="submit"]');
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    // Defensive Guard: Ensure fields aren't blank
    if (!username || !password) {
        alert("Please fill in all layout fields.");
        return;
    }

    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }, // This flags the server body parser to unpack the payload
            body: JSON.stringify({ username, password }) // It collapses our loose object variables into a clean stringified network packet stream.
        });

        const data = await response.json();

        if (response.ok && data.token) {
            loginMessage.textContent = data.message || "Access granted!";
            loginMessage.style.color = "#10b981";
            loginForm.reset();
            
            // Save the secure token and the username to local storage memory 
            localStorage.setItem('userToken', data.token);
            localStorage.setItem('username', data.username);

            console.log(`[AUTH SUCCESS] Session token saved for: ${data.username}`);
            
            // SMART ROUTING GATEWAY: Redirect to admin panel if username is your admin profile
            // Otherwise, route them directly into your main game dashboard interface
            if (data.username === 'admin' || data.username === 'Yolo_Ranger') {
                window.location.href = 'admin.html';
            } else {
                alert(`Welcome back, ${data.username}! Connecting to game server...`);
                // Redirect the user out of the gateway and straight into the main casino table card
                setTimeout(() => {
                   window.location.href = '/index.html';
                }, 1000); // This is a standard mechanism that automatically redirect a browser's address bar routing pathway to a new resource file, in this case "index.html"

                // If you have a dedicated game dashboard view, toggle it here:
                // document.getElementById('loginFormContainer').style.display = 'none';
                // loadPlayerGameBalance();
            }
        } 
        
        else {
            // Display secure ambiguous error message directly from backend
            alert(data.message || "Invalid credentials execution failure.");
            loginMessage.style.color = "#ef4444";
            submitBtn.disabled = false;
        }

    } catch (error) {
        loginMessage.textContent = "Network Connection error.";
        loginMessage.style.color = "#ef4444";
        submitBtn.disabled = false;
        console.error("Authentication link failure:", error);
    }
});
// Helper: Pull balance securely from dashboard contexts using saved passport
async function fetchAccountBalance() {
    // Reads perfectly from unified token storage layout key setup above
    const token = localStorage.getItem('userToken');
    if (!token) return;

    try {
        const response = await fetch('/balance', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`, 
                'Content-Type': 'application/json'
            }
        });
        const data = await response.json();
        return data;
    } catch (error) {
        console.error("Balance synchronization drop:", error);
    }
}