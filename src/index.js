require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

const app = express();

// ---------- middleware ----------
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));

// ---------- helpers ----------
function normalizeEmail(e) { return String(e || '').trim().toLowerCase(); }
function kcal(n){ return Math.max(50, Math.round(n)); }
function grams(n){ return Math.max(1, Math.round(n)); }
function pickByDiet(recipe, pref){
  if (!pref) return true;
  const p = String(pref).toLowerCase();
  if (p === 'vegetarian') return recipe.diet === 'vegetarian' || recipe.diet === 'vegan';
  if (p === 'vegan')       return recipe.diet === 'vegan';
  return true; // non-veg can eat all
}
function avoidDislikes(recipe, dislikeSlugs = []){
  if (!Array.isArray(dislikeSlugs) || dislikeSlugs.length === 0) return true;
  const set = new Set(dislikeSlugs.map(s=>String(s).toLowerCase()));
  return !(recipe.ingredients||[]).some(ing => set.has(String(ing).toLowerCase()));
}

// ---------- DB connect & routes ----------
(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected');

    const db = mongoose.connection.db;
    const Users = db.collection('users');
    const Recipes = db.collection('recipes');
    const MealPlans = db.collection('mealplans');

    // =============== SEED RECIPES (only if empty) =================
    async function ensureSeed() {
      const count = await Recipes.countDocuments();
      if (count > 0) return;

      const seed = [
        {
          title: 'Masala Oats',
          diet: 'vegetarian',
          mealType: 'breakfast',
          ingredients: ['oats','onion','tomato','carrot'],
          image: '/images/masala-oats.jpg',
          macros: { calories: 350, protein: 15, carbs: 55, fat: 9 }
        },
        {
          title: 'Paneer Bhurji',
          diet: 'vegetarian',
          mealType: 'lunch',
          ingredients: ['paneer','onion','tomato'],
          image: '/images/paneer-bhurji.jpg',
          macros: { calories: 420, protein: 28, carbs: 18, fat: 24 }
        },
        {
          title: 'Chana Salad',
          diet: 'vegan',
          mealType: 'lunch',
          ingredients: ['chickpeas','onion','cucumber','tomato'],
          image: '/images/chana-salad.jpg',
          macros: { calories: 300, protein: 17, carbs: 42, fat: 6 }
        },
        {
          title: 'Grilled Chicken + Veg',
          diet: 'non-veg',
          mealType: 'dinner',
          ingredients: ['chicken','broccoli','carrot','garlic'],
          image: '/images/grilled-chicken.jpg',
          macros: { calories: 500, protein: 45, carbs: 20, fat: 26 }
        },
        {
          title: 'Veg Pulao + Raita',
          diet: 'vegetarian',
          mealType: 'dinner',
          ingredients: ['rice','peas','carrot','yogurt'],
          image: '/images/veg-pulao.jpg',
          macros: { calories: 520, protein: 14, carbs: 85, fat: 14 }
        },
        {
          title: 'Tofu Stir Fry',
          diet: 'vegan',
          mealType: 'dinner',
          ingredients: ['tofu','capsicum','onion','soy'],
          image: '/images/tofu-stirfry.jpg',
          macros: { calories: 420, protein: 28, carbs: 28, fat: 18 }
        },
        {
          title: 'Egg Bhurji Toast',
          diet: 'non-veg',
          mealType: 'breakfast',
          ingredients: ['egg','onion','tomato','bread'],
          image: '/images/egg-bhurji.jpg',
          macros: { calories: 380, protein: 22, carbs: 32, fat: 16 }
        },
        {
          title: 'Moong Dal Khichdi',
          diet: 'vegan',
          mealType: 'lunch',
          ingredients: ['rice','moong dal','turmeric'],
          image: '/images/khichdi.jpg',
          macros: { calories: 430, protein: 18, carbs: 80, fat: 6 }
        },
        {
          title: 'Curd Rice',
          diet: 'vegetarian',
          mealType: 'lunch',
          ingredients: ['rice','yogurt','mustard'],
          image: '/images/curd-rice.jpg',
          macros: { calories: 460, protein: 12, carbs: 80, fat: 10 }
        },
        {
          title: 'Peanut Poha',
          diet: 'vegan',
          mealType: 'breakfast',
          ingredients: ['poha','peanut','onion'],
          image: '/images/poha.jpg',
          macros: { calories: 360, protein: 10, carbs: 58, fat: 12 }
        },
        {
          title: 'Chicken Salad Bowl',
          diet: 'non-veg',
          mealType: 'lunch',
          ingredients: ['chicken','lettuce','cucumber','onion'],
          image: '/images/chicken-salad.jpg',
          macros: { calories: 420, protein: 40, carbs: 18, fat: 18 }
        },
        {
          title: 'Veggie Omelette',
          diet: 'non-veg',
          mealType: 'breakfast',
          ingredients: ['egg','onion','capsicum','tomato'],
          image: '/images/omelette.jpg',
          macros: { calories: 320, protein: 20, carbs: 10, fat: 22 }
        }
      ];

      await Recipes.insertMany(seed.map(r => ({
        ...r,
        createdAt: new Date()
      })));

      console.log(`🌱 Seeded ${seed.length} recipes`);
    }
    await ensureSeed();

    // =========================================================
    // AUTH (no email verification)
    // =========================================================
    app.post('/api/users/signup', async (req, res) => {
      try {
        const { name, email, password } = req.body;
        if (!name || !email || !password)
          return res.status(400).json({ ok: false, message: 'All fields required' });

        const cleanEmail = normalizeEmail(email);
        const existing = await Users.findOne({ email: cleanEmail });
        if (existing)
          return res.status(409).json({ ok: false, message: 'Email already exists' });

        const passwordHash = await bcrypt.hash(password, 10);
        const newUser = {
          name,
          email: cleanEmail,
          passwordHash,
          verified: true,
          profile: {},
          createdAt: new Date(),
        };
        await Users.insertOne(newUser);

        const token = jwt.sign({ email: cleanEmail }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
        const { passwordHash: _, ...safeUser } = newUser;
        res.json({ ok: true, message: 'Account created', token, user: safeUser });
      } catch (err) {
        console.error('signup error:', err);
        res.status(500).json({ ok: false, message: 'Server error' });
      }
    });

    app.post('/api/users/login', async (req, res) => {
      try {
        const { email, password } = req.body;
        const cleanEmail = normalizeEmail(email);
        const user = await Users.findOne({ email: cleanEmail });
        if (!user) return res.status(400).json({ ok: false, message: 'Invalid credentials' });

        const valid = await bcrypt.compare(password, user.passwordHash || '');
        if (!valid) return res.status(400).json({ ok: false, message: 'Invalid credentials' });

        const token = jwt.sign({ email: cleanEmail }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
        const { passwordHash: _, ...safeUser } = user;
        res.json({ ok: true, token, user: safeUser });
      } catch (err) {
        console.error('login error:', err);
        res.status(500).json({ ok: false, message: 'Server error' });
      }
    });

    // =========================================================
    // PROFILE (Dashboard)
    // =========================================================
    app.get('/api/users/profile/:email', async (req, res) => {
      try {
        const email = normalizeEmail(req.params.email);
        const user = await Users.findOne({ email });
        if (!user) return res.status(404).json({ ok: false, message: 'User not found' });
        const { passwordHash: _, ...safeUser } = user;
        res.json({ ok: true, user: safeUser });
      } catch (err) {
        console.error('profile GET error:', err);
        res.status(500).json({ ok: false, message: 'Server error' });
      }
    });

    app.put('/api/users/profile/:email', async (req, res) => {
      try {
        const email = normalizeEmail(req.params.email);
        const profile = req.body || {};
        const user = await Users.findOne({ email });
        if (!user) return res.status(404).json({ ok: false, message: 'User not found' });
        await Users.updateOne({ email }, { $set: { profile } });
        const updated = await Users.findOne({ email });
        const { passwordHash: _, ...safeUser } = updated;
        res.json({ ok: true, user: safeUser });
      } catch (err) {
        console.error('profile PUT error:', err);
        res.status(500).json({ ok: false, message: 'Server error' });
      }
    });

    // =========================================================
    // META (for dropdowns)
    // =========================================================
    app.get('/api/meta/health', (req, res) => {
      res.json({
        items: [
          { slug: 'diabetes', condition_name: 'Diabetes' },
          { slug: 'pcos', condition_name: 'PCOS' },
          { slug: 'thyroid', condition_name: 'Thyroid' },
          { slug: 'bp', condition_name: 'High Blood Pressure' },
          { slug: 'cholesterol', condition_name: 'High Cholesterol' }
        ]
      });
    });

    app.get('/api/meta/ingredients', (req, res) => {
      res.json({
        items: [
          { slug: 'milk', ingredient_name: 'Milk', type: 'dairy' },
          { slug: 'egg', ingredient_name: 'Egg', type: 'protein' },
          { slug: 'chicken', ingredient_name: 'Chicken', type: 'protein' },
          { slug: 'onion', ingredient_name: 'Onion', type: 'veg' },
          { slug: 'peanut', ingredient_name: 'Peanut', type: 'nut' },
          { slug: 'garlic', ingredient_name: 'Garlic', type: 'veg' },
          { slug: 'wheat', ingredient_name: 'Wheat', type: 'grain' }
        ]
      });
    });

    // =========================================================
    // RECIPES
    // =========================================================
    app.get('/api/recipes', async (req, res) => {
      try {
        const recipes = await Recipes.find({}).project({ }).toArray();
        res.json({ ok: true, items: recipes });
      } catch (err) {
        console.error('recipes list error:', err);
        res.json({ ok: true, items: [] });
      }
    });

    // ⬅️ Needed for “View Recipe”
    app.get('/api/recipes/:id', async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) return res.status(400).json({ ok: false, message: 'Bad id' });
        const recipe = await Recipes.findOne({ _id: new ObjectId(id) });
        if (!recipe) return res.status(404).json({ ok: false, message: 'Recipe not found' });
        res.json({ ok: true, recipe });
      } catch (err) {
        console.error('recipe detail error:', err);
        res.status(500).json({ ok: false, message: 'Server error' });
      }
    });

    // =========================================================
    // MEAL PLAN
    // =========================================================
    // Generate a plan (front-end can POST profile here)
    app.post('/api/mealplan/generate', async (req, res) => {
      try {
        const {
          days = 1,
          calories = 2000,
          dietaryType = 'Non-Vegetarian',
          dislike_slugs = []
        } = req.body || {};

        const all = await Recipes.find({}).toArray();
        const filtered = all.filter(r =>
          pickByDiet(r, dietaryType) && avoidDislikes(r, dislike_slugs)
        );

        if (filtered.length === 0) {
          return res.json({ ok: true, items: [], message: 'No recipes match filters' });
        }

        const perMeal = kcal(calories / 3);
        const plan = [];

        function pick(mealType){
          // choose recipe whose calories is closest to perMeal
          let best = null, bestDiff = Infinity;
          for (const r of filtered) {
            if (r.mealType !== mealType) continue;
            const diff = Math.abs((r.macros?.calories || 0) - perMeal);
            if (diff < bestDiff) { best = r; bestDiff = diff; }
          }
          // fallback: any recipe if no strict mealType match
          return best || filtered[Math.floor(Math.random() * filtered.length)];
        }

        for (let d = 0; d < Math.max(1, Math.min(7, +days)); d++){
          const b = pick('breakfast');
          const l = pick('lunch');
          const dn = pick('dinner');
          plan.push({
            day: d+1,
            meals: [
              { slot: 'breakfast', recipeId: b._id, title: b.title, image: b.image, macros: b.macros },
              { slot: 'lunch',     recipeId: l._id, title: l.title, image: l.image, macros: l.macros },
              { slot: 'dinner',    recipeId: dn._id, title: dn.title, image: dn.image, macros: dn.macros },
            ]
          });
        }

        res.json({ ok: true, items: plan });
      } catch (err) {
        console.error('mealplan generate error:', err);
        res.status(500).json({ ok: false, message: 'Failed to generate meal plan' });
      }
    });

    // Save/load user plans (kept from your earlier flow)
    app.get('/api/mealplan/:email', async (req, res) => {
      try {
        const email = normalizeEmail(req.params.email);
        const plans = await MealPlans.find({ email }).sort({ createdAt: -1 }).toArray();
        res.json({ ok: true, items: plans });
      } catch (err) {
        console.error('mealplan GET error:', err);
        res.json({ ok: true, items: [] });
      }
    });

    app.post('/api/mealplan/:email', async (req, res) => {
      try {
        const email = normalizeEmail(req.params.email);
        const plan = req.body || {};
        plan.email = email;
        plan.createdAt = new Date();
        await MealPlans.insertOne(plan);
        res.json({ ok: true, message: 'Meal plan saved' });
      } catch (err) {
        console.error('mealplan save error:', err);
        res.status(500).json({ ok: false, message: 'Failed to save meal plan' });
      }
    });

    // =========================================================
    // MISC
    // =========================================================
    app.get('/api/health', (_req, res) => res.json({ ok: true }));

    app.get('/', (_req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'signup.html'));
    });

    const PORT = process.env.PORT || 4000;
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err);
    process.exit(1);
  }
})();
