const mongoose = require('mongoose');

const IngredientSchema = new mongoose.Schema({
  ingredient_name: String,
  slug: { type: String, index: true },
  type: String,
  allergens: [String],
  substitutes: [String]
}, { timestamps: true });

// 👇 force collection name to match Atlas exactly
module.exports = mongoose.model('Ingredient', IngredientSchema, 'ingredients');
