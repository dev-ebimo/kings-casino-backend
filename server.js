// LINE 1: Load hidden environment tokens safely into server memory
require('dotenv').config();

const express = require('express'); 
const mongoose = require('mongoose'); 
const bcrypt = require('bcryptjs'); // Swapped to bcryptjs to prevent compilation errors across environments
const jwt = require('jsonwebtoken'); 
const axios = require('axios'); // Standardized for all outbound API communication calls
const cors = require('cors'); 
const crypto = require('crypto');
const winston = require('winston');

// CRITICAL SECURITY FIXES: Imported missing production packages
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// CRITICAL SECURITY FIX: Never supply a default secret string inside your codebase
if (!process.env.JWT_SECRET) {
    console.error("FATAL ERROR: JWT_SECRET environment variable is completely missing!");
    process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

const app = express(); 
const PORT = process.env.PORT || 3000; 

// ENTERPRISE SYSTEM LOGGING LAYER (WINSTON)
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'casino-backend-engine' },
    transports: [
        // Save records of errors explicitly
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        // Capture everything cleanly in a historical master roll file
        new winston.transports.File({ filename: 'logs/combined.log' })
    ]
});

// If we are developing locally, print formatted logs directly to the console too
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

// Clean, standardized HTTP domain string addresses for CORS validation
const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500', 
    'http://127.0.0.1:5500',
    'https://kings-casino-backend.onrender.com'
];

// Secure HTTP Headers
app.use(helmet());

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true); 
        } else {
            logger.warn(`CORS Violation Encountered: Unauthorized origin attempted connection`, { origin });
            callback(new Error('Blocked by CORS Policy: This origin is unauthorized.'));
        }
    },
    credentials: true, 
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-paystack-signature']
}));

// CRITICAL RESTRUCTURE: PRE-PARSED WEBHOOK
// This endpoint must live ABOVE express.json() to capture raw payload text buffers
app.post('/deposit/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const signature = req.headers['x-paystack-signature'];
        if (!signature) {
            logger.error('Webhook Access Failure: Missing X-Paystack-Signature Header');
            return res.status(401).send("Missing security validation passport signature.");
        }

        // Calculate cryptographic hash matching against the immutable raw text buffer request bytes
        const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
                           .update(req.body)
                           .digest('hex');

        if (hash !== signature) {
            logger.error('Security Breach Prevented: Paystack Webhook Cryptographic Signature Mismatch');
            return res.status(401).send("Security verification failed. Signature mismatch.");
        }

        // Since the body is an unparsed buffer string, we manually unpack it now
        const event = JSON.parse(req.body.toString());

        if (event && event.event === 'charge.success') {
            const reference = event.data.reference;

            // Prevent duplicate processing of the same transaction reference
            const existingTx = await Transaction.findOne({ reference: reference });
            if (existingTx) {
                logger.warn(`Duplicate Deposit Event Blocked: Paystack Reference already processed`, { reference });
                return res.sendStatus(200);
            }

            const koboAmount = event.data.amount;
            const nairaAmount = Math.floor(koboAmount / 100);
            
            const userEmail = event.data.customer.email;
            const extractedUsername = userEmail.split('@')[0];

            logger.info(`Valid Payload Received: Processing deposit transaction request`, { username: extractedUsername, reference, amount: nairaAmount });

            // Safe regex lookup avoiding injection vulnerabilities
            const cleanEscapedUsername = extractedUsername.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const player = await User.findOne({ 
                username: { $regex: new RegExp('^' + cleanEscapedUsername + '$', 'i') } 
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

                logger.info(`Wallet Successfully Funded: Balance updated on database`, { username: player.username, newBalance: balanceAfter });
            } else {
                logger.error(`Deposit Settlement Failed: User account not found on database`, { username: extractedUsername, reference });
            }
        }
        res.sendStatus(200);
    } catch (error) {
        logger.error("Critical Failure inside Paystack Webhook Controller Node", { error: error.message });
        res.sendStatus(500);
    }
});

// Standard Parsers for all subsequent standard API route collections
app.use(express.json()); 

// THE FIX: Sanitize NoSQL injection attempts AND escape unsafe HTML characters
// by mutating req.body / req.query / req.params IN PLACE. We deliberately do
// NOT do `req.query = ...` anywhere below: on modern Express (5.x) and Node,
// req.query is a getter-only property, and reassigning it throws
// "Cannot set property query of #<IncomingMessage> which has only a getter"
// (this is exactly what xss-clean and older sanitizer patterns do internally,
// which is why that package has been removed).
function sanitizeInPlace(obj) {
    if (!obj || typeof obj !== 'object') return;

    for (const key of Object.keys(obj)) {
        // Strip Mongo operator-style keys ($gt, $where, "a.b", etc.)
        if (key.startsWith('$') || key.includes('.')) {
            delete obj[key];
            continue;
        }

        const value = obj[key];

        if (typeof value === 'string') {
            obj[key] = value
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#x27;');
        } else if (value && typeof value === 'object') {
            sanitizeInPlace(value); // recurse into nested objects/arrays
        }
    }
}

app.use((req, res, next) => {
    sanitizeInPlace(req.body);
    sanitizeInPlace(req.query);
    sanitizeInPlace(req.params);
    next();
});

app.use(express.static('public')); 

// Rate Limiting to prevent Login / Authentication Brute-Force Attacks
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 15, 
    message: { error: 'Too many attempts from this IP. Please try again after 15 minutes.' }
});
app.use('/signup', authLimiter);
app.use('/login', authLimiter);

// Dynamic Database Connection Mapping
const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/spin_db';

mongoose.connect(mongoURI)
    .then(() => logger.info(`MongoDB connection established successfully`, { cluster: mongoURI.includes('localhost') ? 'LOCAL_DEVELOPMENT' : 'CLOUD_ATLAS_PRODUCTION' }))
    .catch(err => logger.error("Database initialization execution failure", { error: err.message }));

// SYSTEM SCHEMAS & INTERACTION DATABASE MODELS
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

// SECURITY AUTHENTICATION HANDSHAKES
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
            logger.warn(`[SECURITY WARNING] Unauthorized administration workspace breakout attempt intercepted`, { userId: req.userId });
            return res.status(403).json({ message: "Access Denied: Admin privileges required." });
        }
        next(); 
    } catch (error) {
        logger.error("Authentication validation server error", { error: error.message });
        res.status(500).json({ message: "Auth validation server error." });
    }
}

// USER ACCOUNT REGISTRATION & SECURITY SIGNUP
app.post('/signup', async(req, res) => {
    try {
        const { username, password } = req.body; 

        if (!username || !password || username.trim().length < 3) {
            return res.status(400).json({ message: "Invalid validation criteria parameters supplied." });
        }

        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: "Username is already taken." });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const newUser = new User({
            username: username.trim(),
            password: hashedPassword 
        });

        await newUser.save();
        logger.info(`New Player Registered`, { username: newUser.username, id: newUser._id });
        
        res.json({ message: "Account created successfully! You can now log in." });
    }
    catch(error){
        logger.error("Registration operational pipeline processing failure", { error: error.message });
        res.status(500).json({ message: "Server error during registration."});
    }
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const player = await User.findOne({ username });
        if (!player) {
            logger.warn(`Authentication Failure: Non-existent profile registration name lookup`, { username });
            return res.status(400).json({ message: "Invalid username or password." });
        }

        const isMatch = await bcrypt.compare(password, player.password);
        if (!isMatch) {
            logger.warn(`Authentication Failure: Password verification challenge mismatch`, { username });
            return res.status(400).json({ message: "Invalid username or password." });
        } 
        
        const token = jwt.sign(
            { userId: player._id, role: player.role },
            JWT_SECRET,
            { expiresIn: '2h'} 
        );

        logger.info(`User Authenticated Successfully`, { username: player.username, role: player.role });

        res.json({
            message: "Login successful! Welcome back.",
            token: token,
            username: player.username
        });

    } catch (error) {
        logger.error("Login verification loop framework failure", { error: error.message });
        res.status(500).json({ message: "Server error during login." });
    }
});

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

// CORE GAME CALCULATOR PROBABILITIES ENGINE
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

        // 1. Math Evaluation Stage: Check for Draw State (3% probability boundary)
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

            logger.info(`Game Played: Resulting in House Draw (Perfect Middle Split)`, { username: player.username, wager: betAmount, refund });

            return res.json({
                success: true,
                outcomeType: "middle",
                exactAngle: exactAngle,
                newBalance: player.balance,
                message: `House Draw! Bottle landed perfectly on the line. 50% refund (+₦${refund})`
            });
        }

        // 2. Math Evaluation Stage: standard win calculations with streak safety rules
        let winThreshold = 0.5; 
        if (player.lossStreak >= 3) {
            winThreshold = 0.4; 
        }

        const isWin = Math.random() > winThreshold;
        const isNearMiss = Math.random() <= 0.20; 
        let exactAngle = 0;

        if (isWin) {
            player.balance = initialBalanceSnap + betAmount;
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
            player.balance = initialBalanceSnap - betAmount;
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

        logger.info(`Game Played: Assessment calculated`, { username: player.username, betAmount, prediction, isWin, newBalance: player.balance });

        res.json({
            success: true,
            outcomeType: isNearMiss ? "near_miss" : "standard",
            isWin: isWin,
            exactAngle: exactAngle,
            newBalance: player.balance,
            message: isWin ? `Jackpot! +₦${betAmount}` : `Better Luck Next Time! -₦${betAmount}`
        });

    } catch (error) {
        logger.error("Advanced Spin Engine Core Crash", { error: error.message });
        res.status(500).json({ message: "Server math error." });
    }
}); 

// PAYSTACK OUTBOUND INTENT INITIALIZATION NODES
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
        const callbackUrl = `${process.env.APP_BASE_URL}/deposit/callback`;

        logger.info(`Requesting Paystack Checkout Session Allocation`, { username: player.username, amount: Number(amount) });

        const paystackResponse = await axios.post('https://api.paystack.co/transaction/initialize', {
            email: userEmail,
            amount: amountInKobo,
            callback_url: callbackUrl,
            metadata: { username: player.username }
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
        logger.error("Paystack External Handshake Fault Encountered", { error: routeError.message });
        return res.status(500).json({ success: false, message: "Unable to connect with Paystack payment core engine." });
    }
});

app.get('/deposit/callback', (req, res) => {
    const { reference } = req.query;
    logger.info(`Client redirected back from checkout portal link context`, { reference });

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
});

// METRICS & MANAGEMENT PORTAL OPERATIONS
app.get('/admin/analytics', authenticateToken, isAdmin, async (req, res) => {
    try {
        logger.info(`Admin Workspace Metrics Compiled Active State Triggered`, { authorizedAdminId: req.userId });
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
        logger.error("Admin Analytics Extraction Subsystem Failure Fault", { error: error.message });
        res.status(500).json({ message: "Failed to compile administration metrics profiles." });
    }
});

app.listen(PORT, () => logger.info(`System Server Engine online and monitoring port address allocation listener: ${PORT}`));