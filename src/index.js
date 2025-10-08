require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { ObjectId } = require("mongodb");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Helper
const normalizeEmail = (e) => String(e || "").trim().toLowerCase();

// Connect and run server
(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ MongoDB connected");

    const db = mongoose.connection.db;
    const Users = db.collection("users");
    const Recipes = db.collection("recipes");
    const MealPlans = db.collection("mealplans");

    // ---------- Seed Recipes ----------
    async function seedRecipes() {
      const count = await Recipes.countDocuments();
      if (count > 0) return;

      const recipes = [
        {
          title: "Masala Oats",
          diet: "vegetarian",
          mealType: "breakfast",
          ingredients: ["oats", "onion", "tomato"],
          image: "/images/masala-oats.jpg",
          macros: { calories: 350, protein: 15, carbs: 55, fat: 9 },
        },
        {
          title: "Paneer Bhurji",
          diet: "vegetarian",
          mealType: "lunch",
          ingredients: ["paneer", "onion", "tomato"],
          image: "/images/paneer-bhurji.jpg",
          macros: { calories: 420, protein: 28, carbs: 18, fat: 24 },
        },
        {
          title: "Grilled Chicken",
          diet: "non-veg",
          mealType: "dinner",
          ingredients: ["chicken", "garlic", "onion"],
          image: "/images/grilled-chicken.jpg",
          macros: { calories: 500, protein: 45, carbs: 20, fat: 26 },
        },
      ];
      await Recipes.insertMany(recipes);
      console.log("🌱 Sample recipes added");
    }
    await seedRecipes();

    // ---------- Signup ----------
    app.post("/api/users/signup", async (req, res) => {
      try {
        const { name, email, password } = req.body;
        if (!name || !email || !password)
          return res
            .status(400)
            .json({ ok: false, message: "All fields are required" });

        const cleanEmail = normalizeEmail(email);
        const existing = await Users.findOne({ email: cleanEmail });
        if (existing)
          return res
            .status(409)
            .json({ ok: false, message: "Email already registered" });

        const passwordHash = await bcrypt.hash(password, 10);
        const newUser = {
          name,
          email: cleanEmail,
          passwordHash,
          profile: {},
          createdAt: new Date(),
        };
        await Users.insertOne(newUser);

        const token = jwt.sign(
          { email: cleanEmail },
          process.env.JWT_SECRET || "secret",
          { expiresIn: "7d" }
        );

        res.json({
          ok: true,
          message: "Signup successful",
          token,
          user: { name, email: cleanEmail },
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, message: "Server error" });
      }
    });

    // ---------- Login ----------
    app.post("/api/users/login", async (req, res) => {
      try {
        const { email, password } = req.body;
        const cleanEmail = normalizeEmail(email);
        const user = await Users.findOne({ email: cleanEmail });
        if (!user)
          return res
            .status(400)
            .json({ ok: false, message: "Invalid email or password" });

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid)
          return res
            .status(400)
            .json({ ok: false, message: "Invalid email or password" });

        const token = jwt.sign(
          { email: cleanEmail },
          process.env.JWT_SECRET || "secret",
          { expiresIn: "7d" }
        );
        res.json({ ok: true, token, user });
      } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, message: "Server error" });
      }
    });

    // ---------- Profile ----------
    app.get("/api/users/profile/:email", async (req, res) => {
      try {
        const email = normalizeEmail(req.params.email);
        const user = await Users.findOne({ email });
        if (!user)
          return res.status(404).json({ ok: false, message: "User not found" });
        res.json({ ok: true, user });
      } catch (err) {
        res.status(500).json({ ok: false, message: "Server error" });
      }
    });

    app.put("/api/users/profile/:email", async (req, res) => {
      try {
        const email = normalizeEmail(req.params.email);
        const profile = req.body;
        await Users.updateOne({ email }, { $set: { profile } });
        const updated = await Users.findOne({ email });
        res.json({ ok: true, user: updated });
      } catch (err) {
        res.status(500).json({ ok: false, message: "Server error" });
      }
    });

    // ---------- Recipes ----------
    app.get("/api/recipes", async (req, res) => {
      try {
        const recipes = await Recipes.find({}).toArray();
        res.json({ ok: true, items: recipes });
      } catch (err) {
        res.status(500).json({ ok: false, items: [] });
      }
    });

    app.get("/api/recipes/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).json({ ok: false, message: "Invalid ID" });
        const recipe = await Recipes.findOne({ _id: new ObjectId(id) });
        if (!recipe)
          return res.status(404).json({ ok: false, message: "Not found" });
        res.json({ ok: true, recipe });
      } catch (err) {
        res.status(500).json({ ok: false, message: "Server error" });
      }
    });

    // ---------- Meta ----------
    app.get("/api/meta/health", (req, res) => {
      res.json({
        items: [
          { slug: "diabetes", condition_name: "Diabetes" },
          { slug: "pcos", condition_name: "PCOS" },
          { slug: "bp", condition_name: "Blood Pressure" },
        ],
      });
    });

    app.get("/api/meta/ingredients", (req, res) => {
      res.json({
        items: [
          { slug: "onion", ingredient_name: "Onion" },
          { slug: "milk", ingredient_name: "Milk" },
          { slug: "chicken", ingredient_name: "Chicken" },
        ],
      });
    });

    // ---------- Meal Plan ----------
    app.post("/api/mealplan/generate", async (req, res) => {
      try {
        const { days = 1, dietaryType = "vegetarian" } = req.body;
        const all = await Recipes.find({ diet: dietaryType }).toArray();
        if (all.length === 0)
          return res.json({ ok: true, items: [], message: "No recipes found" });

        const plan = [];
        for (let i = 0; i < days; i++) {
          const breakfast =
            all.find((r) => r.mealType === "breakfast") || all[0];
          const lunch = all.find((r) => r.mealType === "lunch") || all[1];
          const dinner = all.find((r) => r.mealType === "dinner") || all[2];
          plan.push({ day: i + 1, meals: [breakfast, lunch, dinner] });
        }

        res.json({ ok: true, items: plan });
      } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, message: "Failed to generate plan" });
      }
    });

    // ---------- Root ----------
    app.get("/", (req, res) => {
      res.sendFile(path.join(__dirname, "public", "signup.html"));
    });

    const PORT = process.env.PORT || 4000;
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  } catch (err) {
    console.error("MongoDB failed:", err);
  }
})();
