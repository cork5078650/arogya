const mongoose = require('mongoose');

const RecipeIngredientSchema = new mongoose.Schema({
  slug: { type: String, required: true },          // matches ingredients.slug
  quantity: { type: String, default: '' },         // "120g", "1 tsp"
  importance: { type: Number, default: 1 },        // 1..5 (>=3 essential)
  optional: { type: Boolean, default: false },
  staple_slot: { type: Boolean, default: false },  // true if this is the staple in this recipe
  notes: { type: String, default: '' }
}, { _id: false });

const RecipeSchema = new mongoose.Schema({
  recipe_name: { type: String, required: true },
  slug: { type: String, required: true, unique: true, index: true },
  meal_type: { type: String, required: true },     // Breakfast | Lunch | Snack | Dinner
  calories: { type: Number, default: 0 },
  calorie_bucket: { type: String, required: true },// "200","300","400","500","600","700"
  protein: { type: Number, default: 0 },
  carbs: { type: Number, default: 0 },
  fat: { type: Number, default: 0 },
  sodium_mg: { type: Number, default: 0 },
  time_minutes: { type: Number, default: 0 },
  dietaryType: { type: String, default: '' },      // Vegetarian | Vegan | Non-Vegetarian
  tags: { type: [String], default: [] },
  image_url: { type: String, default: '' },        // e.g., "1.jpg"
  servings: { type: Number, default: 1 },
  ingredients: { type: [RecipeIngredientSchema], default: [] },
  staple_options: { type: [String], default: [] }, // allowed staples slugs
  steps: { type: [String], default: [] },
  notes: { type: String, default: '' }
}, { timestamps: true });

// helpful compound index for queries by slot + bucket
RecipeSchema.index({ meal_type: 1, calorie_bucket: 1 });

module.exports = mongoose.model('Recipe', RecipeSchema, 'recipes'); // <- ensure exact collection name

