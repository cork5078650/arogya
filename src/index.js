// src/index.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
// NOTE: Make sure this file exists and exports a working connectDB function
const connectDB = require('./config/db'); 

const app = express();

// --- Synchronous Middleware (Should be around lines 10-14) ---
app.use(cors());
app.use(express.json());

// --- Static File Serving (Should be around lines 16-19) ---
// THIS IS THE AREA WHERE YOUR LINE 18 ERROR OCCURRED. 
// Ensure no other app.use() calls are here.
app.use(express.static(path.join(__dirname, 'public'))); 
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));

const PORT = process.env.PORT || 4000;

// --- Asynchronous Server Startup (Connects DB, then mounts routes) ---
(async () => {
  try {
    // 1. Connect to the Database
    await connectDB(process.env.MONGODB_URI, process.env.MONGO_DB);
    console.log('✅ MongoDB connected successfully');

    // 2. Mount ALL Routers HERE (Inside the try block)
    // The previous error was that these lines were placed too high up.
    app.use('/api/users', require('./routes/auth')); 
    app.use('/api/users', require('./routes/users')); 
    app.use('/api/recipes', require('./routes/recipes'));
    app.use('/api/mealplan', require('./routes/mealplan'));
    
    // Mount meta route (optional)
    try { app.use('/api/meta', require('./routes/meta')); } catch {}
    
    // 3. Root Route
    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'signup.html'));
    });

    // 4. Start the Server
    app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Visit: ${process.env.APP_BASE_URL || 'http://localhost:' + PORT}`);
});


  } catch (err) {
    console.error('❌ Failed to start server:', err.message || err);
    process.exit(1);
  }
})();