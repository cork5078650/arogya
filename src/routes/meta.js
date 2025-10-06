const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

/**
 * GET /api/meta/ingredients
 * -> [{ slug, ingredient_name, type }]
 */
router.get('/ingredients', async (req, res) => {
  try {
    const coll = mongoose.connection.db.collection('ingredients');
    const items = await coll.find({})
      .project({ _id: 0, slug: 1, ingredient_name: 1, type: 1 })
      .sort({ ingredient_name: 1 })
      .toArray();
    res.json({ ok: true, items });
  } catch (err) {
    console.error('meta/ingredients error:', err);
    res.status(500).json({ ok: false, message: 'Failed to fetch ingredients' });
  }
});

/**
 * GET /api/meta/health
 * -> [{ slug, condition_name }]
 */
router.get('/health', async (req, res) => {
  try {
    const coll = mongoose.connection.db.collection('health_conditions');
    const items = await coll.find({})
      .project({ _id: 0, slug: 1, condition_name: 1 })
      .sort({ condition_name: 1 })
      .toArray();
    res.json({ ok: true, items });
  } catch (err) {
    console.error('meta/health error:', err);
    res.status(500).json({ ok: false, message: 'Failed to fetch health conditions' });
  }
});

module.exports = router;
