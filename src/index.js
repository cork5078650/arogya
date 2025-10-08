// src/index.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');

const app = express();

// --- middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));

const PORT = process.env.PORT || 4000;

(async () => {
  try {
    // connect DB
    await connectDB(process.env.MONGODB_URI, process.env.MONGO_DB);
    console.log('✅ MongoDB connected successfully');

    // --- MOUNT ROUTERS (THIS IS THE IMPORTANT BIT) ---
    app.use('/api/users', require('./routes/auth'));
    app.use('/api/users', require('./routes/users'));
    app.use('/api/recipes', require('./routes/recipes'));
    app.use('/api/mealplan', require('./routes/mealplan'));   // ← must be here
    try { app.use('/api/meta', require('./routes/meta')); } catch {}

    // simple health
    app.get('/api/health', (req, res) => res.json({ ok: true }));

    // root -> signup
    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'signup.html'));
    });

    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err.message || err);
    process.exit(1);
  }
})();