// src/index.js
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

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret';

(async () => {
  try {
    await connectDB(process.env.MONGODB_URI, process.env.MONGO_DB);
    console.log('✅ MongoDB connected');

    const db = mongoose.connection.db;
    const Users = db.collection('users');
    const Recipes = db.collection('recipes');
    const Health = db.collection('health_conditions');
    const Ingredients = db.collection('ingredients');
    const MealPlans = db.collection('meal_plans');

    // ----------- SIGNUP -----------
    app.post('/api/users/signup', async (req, res) => {
      try {
        const { name, email, password } = req.body;
        if (!name || !email || !password)
          return res.status(400).json({ ok: false, message: 'All fields required' });

        const existing = await Users.findOne({ email });
        if (existing)
          return res.status(409).json({ ok: false, message: 'Email already exists' });

        const passwordHash = await bcrypt.hash(password, 10);
        const newUser = {
          name,
          email,
          passwordHash,
          verified: true,
          createdAt: new Date(),
          profile: {}
        };

        await Users.insertOne(newUser);
        const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '7d' });

        res.json({ ok: true, message: 'Account created', token, user: newUser });
      } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, message: 'Server error' });
      }
    });

    // ----------- LOGIN -----------
    app.post('/api/users/login', async (req, res) => {
      try {
        const { email, password } = req.body;
        const user = await Users.findOne({ email });
        if (!user) return res.status(400).json({ ok: false, message: 'Invalid credentials' });

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return res.status(400).json({ ok: false, message: 'Invalid credentials' });

        const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ ok: true, token, user });
      } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, message: 'Server error' });
      }
    });

    // ----------- PROFILE ----------
    app.get('/api/users/profile/:email', async (req, res) => {
      try {
        const user = await Users.findOne({ email: req.params.email });
        if (!user) return res.status(404).json({ ok: false, message: 'Not found' });
        res.json({ ok: true, user });
      } catch (err) {
        res.status(500).json({ ok: false, message: 'Server error' });
      }
    });

    app.put('/api/users/profile/:email', async (req, res) => {
      try {
        const { email } = req.params;
        const profile = req.body;
        const result = await Users.findOneAndUpdate(
          { email },
          { $set: { profile } },
          { returnDocument: 'after' }
        );
        res.json({ ok: true, user: result.value });
      } catch (err) {
        res.status(500).json({ ok: false, message: 'Update failed' });
      }
    });

    // ----------- RECIPES ----------
    app.get('/api/recipes', async (req, res) => {
      try {
        const items = await Recipes.find({}).limit(100).toArray();
        res.json({ ok: true, items });
      } catch {
        res.status(500).json({ ok: false, message: 'Failed to load recipes' });
      }
    });

    app.get('/api/recipes/:id', async (req, res) => {
      const { ObjectId } = require('mongodb');
      try {
        const recipe = await Recipes.findOne({ _id: new ObjectId(req.params.id) });
        if (!recipe) return res.status(404).json({ ok: false, message: 'Recipe not found' });
        res.json({ ok: true, recipe });
      } catch {
        res.status(500).json({ ok: false, message: 'Error fetching recipe' });
      }
    });

    // ----------- META (Dashboard dropdowns) ----------
    app.get('/api/meta/health', async (req, res) => {
      try {
        const items = await Health.find({}).toArray();
        res.json({ ok: true, items });
      } catch {
        res.status(500).json({ ok: false, message: 'Failed to fetch health list' });
      }
    });

    app.get('/api/meta/ingredients', async (req, res) => {
      try {
        const items = await Ingredients.find({}).toArray();
        res.json({ ok: true, items });
      } catch {
        res.status(500).json({ ok: false, message: 'Failed to fetch ingredients' });
      }
    });

    // ----------- MEAL PLAN ----------
    app.post('/api/mealplan/generate', async (req, res) => {
      try {
        const { email, preferences } = req.body;
        const sample = await Recipes.find({}).limit(3).toArray(); // simple mock plan
        const plan = { email, date: new Date(), meals: sample };
        await MealPlans.insertOne(plan);
        res.json({ ok: true, plan });
      } catch {
        res.status(500).json({ ok: false, message: 'Failed to generate meal plan' });
      }
    });

    app.get('/api/mealplan/:email', async (req, res) => {
      try {
        const plans = await MealPlans.find({ email: req.params.email })
          .sort({ date: -1 })
          .toArray();
        res.json({ ok: true, plans });
      } catch {
        res.status(500).json({ ok: false, message: 'Failed to fetch plans' });
      }
    });

    // ----------- STATIC ROOT ----------
    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'signup.html'));
    });

    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to start:', err);
    process.exit(1);
  }
})();