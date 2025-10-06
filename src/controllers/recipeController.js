// src/controllers/recipeController.js
const mongoose = require('mongoose');

// helper to coerce numeric fields safely
function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function coerceRecipeNumbers(r) {
  if (!r) return r;
  return {
    ...r,
    calories: toNum(r.calories),
    protein: toNum(r.protein),
    carbs: toNum(r.carbs),
    fats: toNum(r.fats),
    time_minutes: toNum(r.time_minutes),
  };
}

exports.listRecipes = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 24, 100);
    const skip = Math.max(parseInt(req.query.skip) || 0, 0);
    const db = mongoose.connection.db;
    const col = db.collection('recipes');

    const total = await col.countDocuments({});

    const cursor = col.find(
      {},
      {
        projection: {
          _id: 1,
          recipe_name: 1,
          slug: 1,
          meal_type: 1,
          calories: 1,
          protein: 1,
          carbs: 1,       // ✅ Included for card display
          fats: 1,        // ✅ Included for card display
          time_minutes: 1,
          dietaryType: 1,
          tags: 1,
          image_url: 1,
        },
      }
    )
      .sort({ _id: 1 }) // stable order
      .skip(skip)
      .limit(limit);

    const rawItems = await cursor.toArray();
    const items = rawItems.map(coerceRecipeNumbers); // ⬅️ ensures numeric fields are correct

    res.json({ ok: true, total, items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: 'Failed to fetch recipes' });
  }
};

exports.getRecipeBySlug = async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const col = db.collection('recipes');

    // Ensure all fields needed for the modal details are included here too
    const itemRaw = await col.findOne(
      { slug: req.params.slug },
      {
        projection: {
          // All fields for display on the card (and modal header)
          _id: 1, recipe_name: 1, slug: 1, meal_type: 1, calories: 1,
          protein: 1, carbs: 1, fats: 1, time_minutes: 1, dietaryType: 1,
          tags: 1, image_url: 1,
          // Fields needed for the full recipe modal body
          ingredients: 1, steps: 1, notes: 1
        }
      }
    );

    if (!itemRaw) {
      return res.status(404).json({ ok: false, message: 'Not found' });
    }

    const item = coerceRecipeNumbers(itemRaw); // ⬅️ ensure numbers for modal too
    res.json({ ok: true, item });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: 'Failed to fetch recipe' });
  }
};