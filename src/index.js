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
    const Recipes = db.collection('recipes');
    const MealPlans = db.collection('mealplans');

    // =========================================================
    // AUTH
    // =========================================================
    app.post('/api/users/signup', async (req, res) => {
      try {
        const { name, email, password } = req.body;
        if (!name || !email || !password)
          return res.status(400).json({ ok: false, message: 'All fields required' });

        const cleanEmail = normalizeEmail(email);
        const existing = await Users.findOne({ email: cleanEmail });
        if (existing)
          return res.status(409).json({ ok: false, message: 'Email already exists' });

        const passwordHash = await bcrypt.hash(password, 10);
        const newUser = {
          name,
          email: cleanEmail,
          passwordHash,
          verified: true,
          profile: {},
          createdAt: new Date(),
        };
        await Users.insertOne(newUser);

        const token = jwt.sign({ email: cleanEmail }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
        const { passwordHash: _, ...safeUser } = newUser;
        res.json({ ok: true, message: 'Account created', token, user: safeUser });
      } catch (err) {
        console.error('signup error:', err);
        res.status(500).json({ ok: false, message: 'Server error' });
      }
    });

    app.post('/api/users/login', async (req, res) => {
      try {
        const { email, password } = req.body;
        const cleanEmail = normalizeEmail(email);
        const user = await Users.findOne({ email: cleanEmail });
        if (!user)
          return res.status(400).json({ ok: false, message: 'Invalid credentials' });

        const valid = await bcrypt.compare(password, user.passwordHash || '');
        if (!valid)
          return res.status(400).json({ ok: false, message: 'Invalid credentials' });

        const token = jwt.sign({ email: cleanEmail }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
        const { passwordHash: _, ...safeUser } = user;
        res.json({ ok: true, token, user: safeUser });
      } catch (err) {
        console.error('login error:', err);
        res.status(500).json({ ok: false, message: 'Server error' });
      }
    });

    // =========================================================
    // PROFILE (Dashboard)
    // =========================================================
    app.get('/api/users/profile/:email', async (req, res) => {
      try {
        const email = normalizeEmail(req.params.email);
        const user = await Users.findOne({ email });
        if (!user) return res.status(404).json({ ok: false, message: 'User not found' });
        res.json({ ok: true, user: { ...user, passwordHash: undefined } });
      } catch (err) {
        console.error('profile GET error:', err);
        res.status(500).json({ ok: false, message: 'Server error' });
      }
    });

    app.put('/api/users/profile/:email', async (req, res) => {
      try {
        const email = normalizeEmail(req.params.email);
        const profile = req.body || {};
        const user = await Users.findOne({ email });
        if (!user) return res.status(404).json({ ok: false, message: 'User not found' });
        await Users.updateOne({ email }, { $set: { profile } });
        const updated = await Users.findOne({ email });
        res.json({ ok: true, user: { ...updated, passwordHash: undefined } });
      } catch (err) {
        console.error('profile PUT error:', err);
        res.status(500).json({ ok: false, message: 'Server error' });
      }
    });

    // =========================================================
    // META (for dropdowns)
    // =========================================================
    app.get('/api/meta/health', (req, res) => {
      res.json({
        items: [
          { slug: 'diabetes', condition_name: 'Diabetes' },
          { slug: 'pcos', condition_name: 'PCOS' },
          { slug: 'thyroid', condition_name: 'Thyroid' },
          { slug: 'bp', condition_name: 'High Blood Pressure' },
          { slug: 'cholesterol', condition_name: 'High Cholesterol' }
        ]
      });
    });

    app.get('/api/meta/ingredients', (req, res) => {
      res.json({
        items: [
          { slug: 'milk', ingredient_name: 'Milk', type: 'dairy' },
          { slug: 'egg', ingredient_name: 'Egg', type: 'protein' },
          { slug: 'chicken', ingredient_name: 'Chicken', type: 'protein' },
          { slug: 'onion', ingredient_name: 'Onion', type: 'veg' },
          { slug: 'peanut', ingredient_name: 'Peanut', type: 'nut' },
          { slug: 'garlic', ingredient_name: 'Garlic', type: 'veg' },
          { slug: 'wheat', ingredient_name: 'Wheat', type: 'grain' }
        ]
      });
    });

    // =========================================================
    // RECIPES (temporary stub)
    // =========================================================
    app.get('/api/recipes', async (req, res) => {
      try {
        const recipes = await Recipes.find({}).toArray();
        res.json({ ok: true, items: recipes });
      } catch (err) {
        console.error('recipes error:', err);
        res.json({ ok: true, items: [] }); // fallback empty
      }
    });

    // =========================================================
    // MEAL PLAN (temporary stub)
    // =========================================================
    app.get('/api/mealplan/:email', async (req, res) => {
      try {
        const email = normalizeEmail(req.params.email);
        const plans = await MealPlans.find({ email }).toArray();
        res.json({ ok: true, items: plans });
      } catch (err) {
        console.error('mealplan error:', err);
        res.json({ ok: true, items: [] });
      }
    });

    app.post('/api/mealplan/:email', async (req, res) => {
      try {
        const email = normalizeEmail(req.params.email);
        const plan = req.body || {};
        plan.email = email;
        plan.createdAt = new Date();
        await MealPlans.insertOne(plan);
        res.json({ ok: true, message: 'Meal plan saved' });
      } catch (err) {
        console.error('mealplan save error:', err);
        res.status(500).json({ ok: false, message: 'Failed to save meal plan' });
      }
    });

    // =========================================================
    // MISC
    // =========================================================
    app.get('/api/health', (req, res) => res.json({ ok: true }));

    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'signup.html'));
    });

    const PORT = process.env.PORT || 4000;
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err);
    process.exit(1);
  }
})();
