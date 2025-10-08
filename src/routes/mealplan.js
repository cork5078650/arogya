// src/routes/mealplan.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { buildMealPlan } = require('../controllers/mealplanController');

function assertConnected(req, res, next) {
  const ok = mongoose.connection && mongoose.connection.readyState === 1;
  if (!ok) return res.status(503).json({ ok: false, message: 'DB not connected' });
  next();
}

// quick GET to sanity-check mounting in a browser:
router.get('/ping', (req, res) => res.json({ ok: true, route: 'mealplan' }));

// actual mealplan endpoint (POST)
router.post('/', assertConnected, async (req, res) => {
  try {
    const plan = await buildMealPlan(req.body || {});
    return res.json(plan);
  } catch (err) {
    console.error('Mealplan error:', err);
    return res.status(500).json({ ok: false, message: 'Failed to build meal plan' });
  }
});

module.exports = router;