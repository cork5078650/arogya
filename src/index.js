require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// ---------- middleware ----------
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// (optional) expose /images if you store images there
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));

// ---------- helpers ----------
function normalizeEmail(e) {
  return String(e || '').trim().toLowerCase();
}

// ---------- DB connect & routes ----------
(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected');

    const db = mongoose.connection.db;
    const Users = db.collection('users');

    // =========================================================
    // AUTH (keep exactly your simple, no-email-verification flow)
    // =========================================================

    // ---------- SIGNUP ----------
    app.post('/api/users/signup', async (req, res) => {
      try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
          return res.status(400).json({ ok: false, message: 'All fields required' });
        }

        const cleanEmail = normalizeEmail(email);

        const existing = await Users.findOne({ email: cleanEmail });
        if (existing) {
          return res.status(409).json({ ok: false, message: 'Email already exists' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const newUser = {
          name,
          email: cleanEmail,
          passwordHash,
          verified: true,           // no email verification—set true
          profile: {},              // ensure profile object exists
          createdAt: new Date(),
        };

        await Users.insertOne(newUser);

        const token = jwt.sign(
          { email: cleanEmail },
          process.env.JWT_SECRET || 'secret',
          { expiresIn: '7d' }
        );

        // return minimal user (avoid sending passwordHash back)
        const { passwordHash: _, ...safeUser } = newUser;
        res.json({ ok: true, message: 'Account created', token, user: safeUser });
      } catch (err) {
        console.error('signup error:', err);
        res.status(500).json({ ok: false, message: 'Server error' });
      }
    });

    // ---------- LOGIN ----------
    app.post('/api/users/login', async (req, res) => {
      try {
        const { email, password } = req.body;
        const cleanEmail = normalizeEmail(email);

        const user = await Users.findOne({ email: cleanEmail });
        if (!user) {
          return res.status(400).json({ ok: false, message: 'Invalid credentials' });
        }

        const valid = await bcrypt.compare(password, user.passwordHash || '');
        if (!valid) {
          return res.status(400).json({ ok: false, message: 'Invalid credentials' });
        }

        const token = jwt.sign(
          { email: cleanEmail },
          process.env.JWT_SECRET || 'secret',
          { expiresIn: '7d' }
        );

        // don’t leak hash
        const { passwordHash: _, ...safeUser } = user;
        res.json({ ok: true, token, user: safeUser });
      } catch (err) {
        console.error('login error:', err);
        res.status(500).json({ ok: false, message: 'Server error' });
      }
    });

    // =========================================================
    // PROFILE (needed by dashboard.js)
    // GET /api/users/profile/:email
    // PUT /api/users/profile/:email
    // =========================================================

    // GET profile
    app.get('/api/users/profile/:email', async (req, res) => {
      try {
        const email = normalizeEmail(req.params.email);
        const user = await Users.findOne({ email });
        if (!user) {
          return res.status(404).json({ ok: false, message: 'User not found' });
        }
        res.json({ ok: true, user: { ...user, passwordHash: undefined } });
      } catch (err) {
        console.error('profile GET error:', err);
        res.status(500).json({ ok: false, message: 'Server error' });
      }
    });

    // PUT profile (dashboard submits profile object)
    app.put('/api/users/profile/:email', async (req, res) => {
      try {
        const email = normalizeEmail(req.params.email);
        const profile = req.body || {};

        // ensure user exists
        const user = await Users.findOne({ email });
        if (!user) {
          return res.status(404).json({ ok: false, message: 'User not found' });
        }

        await Users.updateOne(
          { email },
          { $set: { profile } }
        );

        const updated = await Users.findOne({ email });
        res.json({
          ok: true,
          user: { ...updated, passwordHash: undefined }
        });
      } catch (err) {
        console.error('profile PUT error:', err);
        res.status(500).json({ ok: false, message: 'Server error' });
      }
    });

    // =========================================================
    // META (health issues + ingredients) — used by dashboard dropdowns
    // =========================================================
    app.get('/api/meta/health', (req, res) => {
      res.json({
        items: [
          { slug: 'diabetes',    condition_name: 'Diabetes' },
          { slug: 'pcos',        condition_name: 'PCOS' },
          { slug: 'thyroid',     condition_name: 'Thyroid' },
          { slug: 'bp',          condition_name: 'High Blood Pressure' },
          { slug: 'cholesterol', condition_name: 'High Cholesterol' }
        ]
      });
    });

    app.get('/api/meta/ingredients', (req, res) => {
      res.json({
        items: [
          { slug: 'milk',     ingredient_name: 'Milk',     type: 'dairy'   },
          { slug: 'egg',      ingredient_name: 'Egg',      type: 'protein' },
          { slug: 'chicken',  ingredient_name: 'Chicken',  type: 'protein' },
          { slug: 'onion',    ingredient_name: 'Onion',    type: 'veg'     },
          { slug: 'peanut',   ingredient_name: 'Peanut',   type: 'nut'     },
          { slug: 'garlic',   ingredient_name: 'Garlic',   type: 'veg'     },
          { slug: 'wheat',    ingredient_name: 'Wheat',    type: 'grain'   }
        ]
      });
    });

    // simple health check
    app.get('/api/health', (req, res) => {
      res.json({ ok: true });
    });

    // ---------- root: serve signup page ----------
    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'signup.html'));
    });

    // ---------- start server ----------
    const PORT = process.env.PORT || 4000;
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

  } catch (err) {
    console.error('❌ MongoDB connection failed:', err);
    process.exit(1);
  }
})();
