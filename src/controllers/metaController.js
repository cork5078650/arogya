const Recipe = require('../models/Recipe');
const Ingredient = require('../models/Ingredient');
const HealthCondition = require('../models/HealthCondition');

exports.getMeta = async (_req, res) => {
  try {
    const [mealTypes, buckets, diets, tags, total] = await Promise.all([
      Recipe.distinct('meal_type'),
      Recipe.distinct('calorie_bucket'),
      Recipe.distinct('dietaryType'),
      Recipe.distinct('tags'),
      Recipe.estimatedDocumentCount()
    ]);
    res.json({ ok: true, total, mealTypes, buckets, diets, tags });
  } catch (e) {
    console.error('meta error:', e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
};

exports.getLookups = async (_req, res) => {
  try {
    const [ingredients, health] = await Promise.all([
      Ingredient.find({}, { _id: 0, ingredient_name: 1, slug: 1, type: 1 }).sort({ ingredient_name: 1 }).lean(),
      HealthCondition.find({}, { _id: 0, condition_name: 1, slug: 1 }).sort({ condition_name: 1 }).lean()
    ]);
    res.json({ ok: true, ingredients, health_conditions: health });
  } catch (e) {
    console.error('lookups error:', e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
};
