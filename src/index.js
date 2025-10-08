require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Connect to MongoDB
(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected');

    const db = mongoose.connection.db;
    const Users = db.collection('users');

    // ---------- SIGNUP ----------
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
        };
        await Users.insertOne(newUser);

        const token = jwt.sign({ email }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });

        res.json({ ok: true, message: 'Account created', token, user: newUser });
      } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, message: 'Server error' });
      }
    });

    // ---------- LOGIN ----------
    app.post('/api/users/login', async (req, res) => {
      try {
        const { email, password } = req.body;
        const user = await Users.findOne({ email });
        if (!user)
          return res.status(400).json({ ok: false, message: 'Invalid credentials' });

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid)
          return res.status(400).json({ ok: false, message: 'Invalid credentials' });

        const token = jwt.sign({ email }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
        res.json({ ok: true, token, user });
      } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, message: 'Server error' });
      }
    });

    // Serve signup page
    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'signup.html'));
    });

    // Start server
    const PORT = process.env.PORT || 4000;
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

  } catch (err) {
    console.error('❌ MongoDB connection failed:', err);
  }
})();
