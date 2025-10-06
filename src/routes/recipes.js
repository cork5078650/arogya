const express = require('express');
const router = express.Router();
const { listRecipes, getRecipeBySlug } = require('../controllers/recipeController');

// list (summary) + filters + pagination
router.get('/', listRecipes);

// detail (full)
router.get('/:slug', getRecipeBySlug);

module.exports = router;
