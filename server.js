const express = require('express');
const cors    = require('cors');
const path    = require('path');
const session = require('express-session');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    }
}));

app.use((req, res, next) => {
    if (req.path === '/' || req.path.endsWith('.html')) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
    }
    next();
});

// ── Protected pages ───────────────────────────────────────────────────────
const PROTECTED_PAGES = [
    '/dashboard.html',
    '/services.html',
    '/service1.html',
    '/service2.html',
    '/service3.html',
    '/service4.html',
    '/service5.html',
    '/service6.html'
];

app.use((req, res, next) => {
    const page = req.path.split('?')[0];
    if (PROTECTED_PAGES.includes(page)) {
        if (req.session && req.session.isAuthenticated) return next();
        return res.redirect('/login.html');
    }
    next();
});

// ── Static files ──────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
app.use('/outputs', (req, res, next) => {
    res.set('Content-Disposition', 'attachment');
    next();
}, express.static(path.join(__dirname, 'public/outputs')));

// ── Auth Middleware ────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
    if (req.session && req.session.isAuthenticated) {
        return next();
    }
    res.status(401).json({ error: 'Unauthorized. Please log in.' });
}

// ── Auth Routes ───────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (
        username === process.env.ADMIN_USERNAME &&
        password === process.env.ADMIN_PASSWORD
    ) {
        req.session.isAuthenticated = true;
        return res.json({ success: true, message: 'Logged in' });
    }
    res.status(401).json({ success: false, error: 'Invalid credentials' });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) return res.status(500).json({ error: 'Could not log out' });
        res.clearCookie('connect.sid', { path: '/' });
        res.json({ success: true });
    });
});

app.get('/api/check-auth', (req, res) => {
    res.json({ authenticated: !!(req.session && req.session.isAuthenticated) });
});

// ── API Routes ────────────────────────────────────────────────────────────
app.use('/api/service1', requireAuth, require('./src/routes/service1'));
app.use('/api/service2', requireAuth, require('./src/routes/service2'));
app.use('/api/service3', requireAuth, require('./src/routes/service3'));
app.use('/api/service4', requireAuth, require('./src/routes/service4'));
app.use('/api/service5', requireAuth, require('./src/routes/service5'));
app.use('/api/service6', requireAuth, require('./src/routes/service6'));

// ── Index fallback ────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Global error handler ──────────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('[APP] Unhandled error:', err.message);
    res.status(500).json({ error: err.message });
});

// ── MongoDB (optional — non-fatal) ────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/re_spa';
try {
    const mongoose = require('mongoose');
    mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
        .then(() => console.log('✅ MongoDB Connected'))
        .catch(err => console.log('⚠️  MongoDB offline (service still functional):', err.code || err.message));
} catch (e) {
    console.log('⚠️  Mongoose not available:', e.message);
}

// ── Listen ────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
    console.log(`\n🚀 Server running → http://localhost:${PORT}\n`);
});

// Catch unhandled rejections so the process doesn't crash
process.on('unhandledRejection', (reason) => {
    console.error('⚠️  Unhandled rejection (kept alive):', reason);
});
process.on('uncaughtException', (err) => {
    console.error('⚠️  Uncaught exception (kept alive):', err.message);
});
