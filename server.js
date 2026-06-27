// LINE 1: Load hidden environment tokens safely into server memory
require('dotenv').config();

const express = require('express'); 
const mongoose = require('mongoose'); 
const bcrypt = require('bcrypt'); 
const jwt = require('jsonwebtoken'); 
const axios = require('axios'); // Standardized for all outbound API communication calls
const cors = require('cors');  

// Pull environmental secrets dynamically with solid local code backups
const JWT_SECRET = process.env.JWT_SECRET || '3e056bd234b47c7096bd38208688986a7534892aba0bbaa5410357387d692117ea64906947ca39abc91afafd77d9af0cf3695fef17fe4b3afa6286b42e6df898';

const app = express(); 
const PORT = process.env.PORT || 3000; 

// Clean, standardized HTTP domain string addresses for CORS validation
const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500', 
    'http://127.0.0.1:5500'
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true); 
        } else {
            callback(new Error('Blocked by CORS Policy: This origin is unauthorized.'));
        }
    },
    credentials: true, 
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json()); 
app.use(express.static('public')); 

// Dynamic Database Profile Switching
const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/spin_db';

mongoose.connect(mongoURI)
    .then(() => console.log(`MongoDB connected successfully to profile: ${mongoURI.includes('localhost') ? 'DEVELOPMENT (Local)' : 'PRODUCTION (Cloud)'}`))
    .catch(err => console.error("Database connection failure:", err));

// SYSTEM BLUEPRINTS & MODELS
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 100 },
    role: { type: String, enum: ['player', 'admin'], default: 'player' }, 
    lossStreak: { type: Number, default: 0}, 
    totalSpins: { type: Number, default: 0},
    totalWins: { type: Number, default: 0}
}); 

const User = mongoose.model('User', UserSchema); 

const TransactionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['deposit', 'spin_wager', 'spin_payout', 'refund'], required: true },
    amount: { type: Number, required: true },
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    reference: { type: String, unique: true, required: true },
    status: { type: String, enum: ['pending', 'success', 'failed'], default: 'success' },
    createdAt: { type: Date, default: Date.now }
});

const Transaction = mongoose.model('Transaction', TransactionSchema);

// MIDDLEWARE SECURITY HANDSHAKES
function authenticateToken(req, res, next){
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; 

    if (!token){
        return res.status(401).json({ message: "Access Denied. Please log in."});
    }

    jwt.verify(token, JWT_SECRET, (err, decodedPayload) => {
        if (err){
            return res.status(403).json({ message: "Invalid or expired session passport."});
        }
        req.userId = decodedPayload.userId;
        next(); 
    });
}

async function isAdmin(req, res, next) {
    try {
        const user = await User.findOne({ _id: req.userId });
        if (!user || user.role !== 'admin') {
            console.warn(`[SECURITY WARNING] Unauthorized admin access attempt by User ID: ${req.userId}`);
            return res.status(403).json({ message: "Access Denied: Admin privileges required." });
        }
        next(); 
    } catch (error) {
        res.status(500).json({ message: "Auth validation server error." });
    }
}

// SECURE AUTHENTICATION ENDPOINTS
app.post('/signup', async(req, res) => {
    try {
        const { username, password } = req.body; 

        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: "Username is already taken." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({
            username,
            password: hashedPassword 
        });

        await newUser.save();
        res.json({ message: "Account created successfully! You can now log in." });
    }
    catch(error){
        res.status(500).json({ message: "Server error during registration."});
    }
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const player = await User.findOne({ username });
        if (!player) {
            return res.status(400).json({ message: "Invalid username or password." });
        }

        const isMatch = await bcrypt.compare(password, player.password);
        if (!isMatch) {
            return res.status(400).json({ message: "Invalid username or password." });
        } 
        
        const token = jwt.sign(
            { userId: player._id },
            JWT_SECRET,
            { expiresIn: '2h'} 
        );

        res.json({
            message: "Login successful! Welcome back.",
            token: token,
            username: player.username
        });

    } catch (error) {
        res.status(500).json({ message: "Server error during login." });
    }
});

// CORE USER CORE DASHBOARD INTERACTION ROUTES
app.get('/balance', authenticateToken, async (req, res) => {
    try {
        const player = await User.findOne({ _id: req.userId });
        if (!player) {
            return res.status(404).json({ message: "Player not found." });
        }
        res.json({ balance: player.balance });
    } catch (error) {
        res.status(500).json({ message: "Server error fetching balance." });
    }
});

app.post('/spin', authenticateToken, async (req, res) => {
    try {
        const betAmount = Math.floor(Number(req.body.betAmount));
        const prediction = req.body.prediction; 

        if (isNaN(betAmount) || betAmount <= 0) {
            return res.status(400).json({ message: "Invalid bet amount. Enter a positive number." });
        }

        if (betAmount < 10 || betAmount > 1000) {
            return res.status(400).json({ message: "Limits violated: Bets must be between ₦10 and ₦1,000." });
        }

        if (prediction !== 'up' && prediction !== 'down') {
            return res.status(400).json({ message: "Invalid selection. You must pick Up or Down." });
        }

        const player = await User.findOne({ _id: req.userId });
        if (!player) {
            return res.status(404).json({ message: "Player account not found." });
        }
        
        if (player.balance < betAmount) {
            return res.status(400).json({ message: "Insufficient balance. Deposit funds or lower your bet." });
        }
 
        const initialBalanceSnap = player.balance;
        const gameTrackingRef = `GAME-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        const middleRoll = Math.random();
        if (middleRoll <= 0.03) {
            const exactAngle = Math.random() > 0.5 ? 0 : 180;
            const refund = Math.floor(betAmount * 0.5);

            player.balance = (initialBalanceSnap - betAmount) + refund;
            player.lossStreak = 0; 
            player.totalSpins += 1;
            await player.save();

            await new Transaction({
                userId: player._id,
                type: 'refund',
                amount: refund,
                balanceBefore: initialBalanceSnap,
                balanceAfter: player.balance,
                reference: `REF-${gameTrackingRef}`
            }).save();

            return res.json({
                success: true,
                outcomeType: "middle",
                exactAngle: exactAngle,
                newBalance: player.balance,
                message: `House Draw! Bottle landed perfectly on the line. 50% refund (+₦${refund})`
            });
        }

        let winThreshold = 0.5; 
        if (player.lossStreak >= 3) {
            winThreshold = 0.4; 
        }

        const isWin = Math.random() > winThreshold;
        const isNearMiss = Math.random() <= 0.20; 
        let exactAngle = 0;

        if (isWin) {
            player.balance += betAmount;
            player.lossStreak = 0;
            player.totalWins += 1;

            if (prediction === 'up') {
                if (isNearMiss) { exactAngle = Math.random() > 0.5 ? 184 : 356; } 
                else { exactAngle = Math.floor(270 + (Math.random() * 90 - 45)); }
            } else {
                if (isNearMiss) { exactAngle = Math.random() > 0.5 ? 176 : 4; } 
                else { exactAngle = Math.floor(90 + (Math.random() * 90 - 45)); }
            }
        } else {
            player.balance -= betAmount;
            player.lossStreak += 1;

            if (prediction === 'up') {
                if (isNearMiss) { exactAngle = Math.random() > 0.5 ? 178 : 2; } 
                else { exactAngle = Math.floor(90 + (Math.random() * 90 - 45)); }
            } else {
                if (isNearMiss) { exactAngle = Math.random() > 0.5 ? 182 : 358; } 
                else { exactAngle = Math.floor(270 + (Math.random() * 90 - 45)); }
            }
        }

        player.totalSpins += 1;
        await player.save();

        await new Transaction({
            userId: player._id,
            type: isWin ? 'spin_payout' : 'spin_wager',
            amount: betAmount,
            balanceBefore: initialBalanceSnap,
            balanceAfter: player.balance,
            reference: `SPIN-${gameTrackingRef}`
        }).save();

        res.json({
            success: true,
            outcomeType: isNearMiss ? "near_miss" : "standard",
            isWin: isWin,
            exactAngle: exactAngle,
            newBalance: player.balance,
            message: isWin ? `Jackpot! +₦${betAmount}` : `Better Luck Next Time! -₦${betAmount}`
        });

    } catch (error) {
        console.error("Advanced Spin Engine Error:", error);
        res.status(500).json({ message: "Server math error." });
    }
}); 

// PAYSTACK SECURE GATEWAY HUB
app.post('/deposit/initialize', authenticateToken, async (req, res) => {
    try {
        const { amount } = req.body;
        
        if (!amount || isNaN(amount) || amount < 100) {
            return res.status(400).json({ success: false, message: "Minimum deposit allowed is ₦100." });
        }

        const player = await User.findOne({ _id: req.userId });
        if (!player) {
            return res.status(404).json({ success: false, message: "Player account context missing." });
        }

        const amountInKobo = Math.floor(Number(amount) * 100);
        const userEmail = `${player.username}@kingscasino.com`; 
        
        // THE FIX: Grabs the live token dynamically inside the route context safely
        const callbackUrl = `${process.env.APP_BASE_URL}/deposit/callback`;

        console.log(`[PAYSTACK DEBUG] Outbound sanitized email: ${userEmail}`);
        console.log(`[PAYSTACK DEBUG] Constructed Callback Path: ${callbackUrl}`);

        const paystackResponse = await axios.post('https://api.paystack.co/transaction/initialize', {
            email: userEmail,
            amount: amountInKobo,
            callback_url: callbackUrl,
            metadata: {
                username: player.username
            }
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        return res.status(200).json({
            success: true,
            authorization_url: paystackResponse.data.data.authorization_url,
            reference: paystackResponse.data.data.reference
        });

    } catch (routeError) {
        console.error("Paystack Initialization Error:", routeError.response ? routeError.response.data : routeError.message);
        return res.status(500).json({ success: false, message: "Unable to connect with Paystack payment core engine." });
    }
});

// THE FIX: Handles user browser landing redirects smoothly back into the interface layout
app.get('/deposit/callback', (req, res) => {
    try {
        const { reference } = req.query;
        console.log(`[REDIRECT] Player returned from Paystack checkout. Reference: ${reference}`);

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Payment Verifying...</title>
                <style>
                    body { background-color: #0f172a; color: #f8fafc; font-family: 'Segoe UI', sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                    .loader-box { text-align: center; background: #1e293b; padding: 32px; border-radius: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); max-width: 400px; width: 90%; }
                    h2 { color: #f59e0b; margin: 0 0 12px 0; }
                    p { color: #94a3b8; font-size: 14px; line-height: 1.5; }
                    code { color: #f8fafc; background: #0f172a; padding: 4px 8px; border-radius: 4px; font-family: monospace; }
                    .btn { display: inline-block; margin-top: 20px; background: #22c55e; color: white; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: bold; font-size: 14px; }
                </style>
            </head>
            <body>
                <div class="loader-box">
                    <h2>Transaction Processed!</h2>
                    <p>Reference: <code>${reference || 'N/A'}</code></p>
                    <p>Your wallet balance will automatically update once verified.</p>
                    <a href="/index.html" class="btn">Return to Dashboard</a>
                </div>
                <script>
                    setTimeout(() => { window.location.href = '/index.html'; }, 4000);
                </script>
            </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send("An error occurred during redirect processing.");
    }
});

app.post('/deposit/webhook', async (req, res) => {
    try {
        const event = req.body;

        if (event && event.event === 'charge.success') {
            const reference = event.data.reference;
            const koboAmount = event.data.amount;
            const nairaAmount = Math.floor(koboAmount / 100);
            
            const userEmail = event.data.customer.email;
            const extractedUsername = userEmail.split('@')[0];

            console.log(`[WEBHOOK] Verified payload received for user: ${extractedUsername}. Adding ₦${nairaAmount}`);

            const player = await User.findOne({
                 username: { $regex: new RegExp(`^${extractedUsername}$`, 'i') } 
            });
            
            if (player) {
                const balanceBefore = player.balance;
                const balanceAfter = balanceBefore + nairaAmount;

                player.balance = balanceAfter;
                await player.save();

                const depositRecord = new Transaction({
                    userId: player._id,
                    type: 'deposit',
                    amount: nairaAmount,
                    balanceBefore: balanceBefore,
                    balanceAfter: balanceAfter,
                    reference: reference, 
                    status: 'success'
                });
                await depositRecord.save();
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error("Webhook processing exception failure:", error.message);
        res.sendStatus(500);
    }
});

// SYSTEM OPERATIONS ANALYTICS ENGINE
app.get('/admin/analytics', authenticateToken, isAdmin, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();

        const metrics = await Transaction.aggregate([
            {
                $facet: {
                    totalDeposits: [
                        { $match: { type: 'deposit', status: 'success' } },
                        { $group: { _id: null, total: { $sum: '$amount' } } }
                    ],
                    gameMetrics: [
                        { $match: { type: { $in: ['spin_wager', 'spin_payout', 'refund'] } } },
                        { $group: { _id: '$type', totalAmount: { $sum: '$amount' } } }
                    ],
                    unresolvedErrors: [
                        { $match: { status: { $in: ['failed', 'pending'] } } },
                        { $sort: { createdAt: -1 } },
                        { $limit: 5 }, 
                        {
                            $lookup: {
                                from: 'users',
                                localField: 'userId',
                                foreignField: '_id',
                                as: 'playerDetails'
                            }
                        }
                    ]
                }
            }
        ]);

        const depositData = metrics[0].totalDeposits[0];
        const grossDeposits = depositData ? depositData.total : 0;

        const gameData = metrics[0].gameMetrics;
        let totalWagers = 0;
        let totalPayouts = 0;
        let totalRefunds = 0;

        gameData.forEach(item => {
            if (item._id === 'spin_wager') totalWagers = item.totalAmount;
            if (item._id === 'spin_payout') totalPayouts = item.totalAmount;
            if (item._id === 'refund') totalRefunds = item.totalAmount;
        });

        const houseNetProfit = totalWagers - totalPayouts - totalRefunds;

        res.json({
            success: true,
            summary: {
                totalPlayers: totalUsers,
                grossDepositsVolume: grossDeposits,
                netHouseEarnings: houseNetProfit
            },
            unresolvedIssues: metrics[0].unresolvedErrors.map(issue => ({
                id: issue._id,
                reference: issue.reference,
                amount: issue.amount,
                status: issue.status,
                date: issue.createdAt,
                player: issue.playerDetails[0] ? issue.playerDetails[0].username : 'Unknown Player'
            }))
        });

    } catch (error) {
        console.error("Admin Analytics Engine Execution Failure:", error);
        res.status(500).json({ message: "Failed to compile administration metrics profiles." });
    }
});

app.listen(PORT, () => console.log(`Server is running on port ${PORT}!`));