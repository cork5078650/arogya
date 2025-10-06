// src/routes/users.js
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

/**
 * Use the existing Mongoose connection to get the "users" collection.
 * Make sure your MongoDB URI includes the correct dbName (e.g. /mealplanner_db).
 */
function getUsersCollection() {
  if (!mongoose.connection?.db) {
    throw new Error('MongoDB is not connected');
  }
  return mongoose.connection.db.collection('users');
}

/**
 * POST /api/users/signup
 * body: { name, email, password }
 */
router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ ok: false, message: 'name, email, password are required' });
  }

  try {
    const users = getUsersCollection();
    const exists = await users.findOne({ email });
    if (exists) {
      return res.status(409).json({ ok: false, message: 'Email already registered' });
    }

    const doc = {
      name,
      email,
      password, // (plain for now; add hashing later)
      createdAt: new Date(),
      profile: {} // initialize empty profile
    };

    await users.insertOne(doc);

    // Return a trimmed user object (don’t send password back)
    const user = { name, email };
    return res.json({ ok: true, message: 'Signup successful', user });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

/**
 * POST /api/users/login
 * body: { email, password }
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ ok: false, message: 'email and password are required' });
  }

  try {
    const users = getUsersCollection();
    const found = await users.findOne({ email, password }); // (plain for now)
    if (!found) {
      return res.status(401).json({ ok: false, message: 'Invalid credentials' });
    }

    // Return user (without password)
    const user = {
      name: found.name,
      email: found.email,
      profile: found.profile || {}
    };

    return res.json({ ok: true, message: 'Login successful', user });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

/**
 * GET /api/users/profile/:email
 * returns the stored profile for a user
 */
router.get('/profile/:email', async (req, res) => {
  const { email } = req.params;
  try {
    const users = getUsersCollection();
    const doc = await users.findOne(
      { email },
      { projection: { _id: 0, email: 1, name: 1, profile: 1 } }
    );
    if (!doc) {
      return res.status(404).json({ ok: false, message: 'User not found' });
    }
    return res.json({ ok: true, user: doc });
  } catch (err) {
    console.error('Get profile error:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

/**
 * PUT /api/users/profile/:email
 * body: profile object (gender, age, height, weight, activity, goal, health, dislikes, dietaryType, etc.)
 */
router.put('/profile/:email', async (req, res) => {
  const { email } = req.params;
  const profileData = req.body || {};

  try {
    const users = getUsersCollection();
    const result = await users.updateOne(
      { email },
      { $set: { profile: profileData, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ ok: false, message: 'User not found' });
    }

    // Return updated user (without password)
    const updated = await users.findOne(
      { email },
      { projection: { _id: 0, email: 1, name: 1, profile: 1 } }
    );

    return res.json({ ok: true, message: 'Profile updated successfully', user: updated });
  } catch (err) {
    console.error('Error updating profile:', err);
    return res.status(500).json({ ok: false, message: 'Failed to update profile' });
  }
});

module.exports = router;
