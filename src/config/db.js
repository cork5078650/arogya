const mongoose = require('mongoose');

async function connectDB(uri) {
  if (!uri) throw new Error('MongoDB URI missing! Check your .env');

  mongoose.set('strictQuery', true); // optional, quieter queries
  await mongoose.connect(uri);       // no deprecated options on Mongoose 8+
  console.log('✅ MongoDB connected successfully');
}

module.exports = connectDB;
