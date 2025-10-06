const mongoose = require('mongoose');

const HealthConditionSchema = new mongoose.Schema({
  condition_name: String,
  slug: { type: String, index: true },
  forbidden: [String],
  caution: [String],
  notes: String
}, { timestamps: true });

// 👇 force collection name
module.exports = mongoose.model('HealthCondition', HealthConditionSchema, 'health_conditions');
