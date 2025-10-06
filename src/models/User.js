const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  email: { type: String, unique: true, sparse: true }, // optional for now
  passwordHash: { type: String, default: '' },         // later for auth
  gender: { type: String, default: '' },               // "Female" | "Male" | etc.
  age: { type: Number, default: 0 },
  height_cm: { type: Number, default: 0 },
  weight_kg: { type: Number, default: 0 },
  activity: { type: String, default: 'Sedentary' },    // Sedentary | Light | Moderate | Active
  goal: { type: String, default: 'Lose Weight' },      // Lose Weight | Maintain | Gain Weight
  health_issues: { type: [String], default: [] },      // health condition slugs
  dislikes: { type: [String], default: [] },           // ingredient slugs
  food_preference: { type: String, default: '' }       // Vegetarian | Vegan | Non-Vegetarian
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
