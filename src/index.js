// src/index.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');

const app = express();

app.use(cors());
app.use(express.json());

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));

// Routes that don't require DB can mount early (and MUST export a router)
try {
  const metaRouter = require('./routes/meta');
  if (typeof metaRouter === 'function') {
    app.use('/api/meta', metaRouter);
  }
} catch (e) {
  console.warn('meta route not mounted:', e?.message || e);
}

const PORT = process.env.PORT || 4000;

(async () => {
  try {
    await connectDB(process.env.MONGODB_URI, process.env.MONGO_DB);
    console.log('✅ MongoDB connected successfully');

    // IMPORTANT: every require here must export a function/router
    const recipesRouter = require('./routes/recipes');
    const usersRouter   = require('./routes/users');   // your existing users routes
    const mealplanRouter= require('./routes/mealplan');
    const authRouter    = require('./routes/auth');    // <-- our new router

    if (typeof recipesRouter !== 'function') throw new Error('routes/recipes does not export a router');
    if (typeof usersRouter   !== 'function') throw new Error('routes/users does not export a router');
    if (typeof mealplanRouter!== 'function') throw new Error('routes/mealplan does not export a router');
    if (typeof authRouter    !== 'function') throw new Error('routes/auth does not export a router');

    // Mount
    app.use('/api/recipes', recipesRouter);
    app.use('/api/users', usersRouter);   // keep your existing users endpoints
    app.use('/api/mealplan', mealplanRouter);

    // Mount our auth flows UNDER /api/users too (they're unique subpaths)
    app.use('/api/users', authRouter);

    app.get('/', (req, res) => {
      res.send('🍽️ Meal Planner API is running! Go to /mealplan.html to try it.');
    });

    app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
  } catch (err) {
    console.error('❌ Failed to start server:', err.message || err);
    process.exit(1);
  }
})();
