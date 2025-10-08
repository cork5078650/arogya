require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const connectDB = require('./config/db');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));

const PORT = process.env.PORT || 4000;

(async () => {
  try {
    await connectDB(process.env.MONGODB_URI, process.env.MONGO_DB);
    console.log('✅ MongoDB connected successfully');

    app.use('/api/users', require('./routes/auth'));
    app.use('/api/users', require('./routes/users'));
    app.use('/api/recipes', require('./routes/recipes'));
    app.use('/api/mealplan', require('./routes/mealplan'));
    try { app.use('/api/meta', require('./routes/meta')); } catch {}

    app.get('/api/health', (req, res) => {
      res.json({ ok: true, envBaseUrl: process.env.APP_BASE_URL || null });
    });

    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'signup.html'));
    });

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌐 Visit: ${process.env.APP_BASE_URL || 'http://localhost:' + PORT}`);
    });

  } catch (err) {
    console.error('❌ Failed to start server:', err.message || err);
    process.exit(1);
  }
})();