const Ingredient = require('../models/Ingredient');
const HealthCondition = require('../models/HealthCondition');

const STAPLE_PREFS_BY_CONDITION = {
  diabetes: {
    white_rice: ['brown_rice', 'millet', 'quinoa'],
    bread_white: ['whole_wheat', 'bread_whole_wheat'],
    whole_wheat_bread: ['whole_wheat', 'bread_whole_wheat'],
    pasta: ['whole_wheat', 'gluten_free_pasta', 'pasta']
  }
};

// small allowlist so we can safely swap even if not listed in DB
const SAFE_KNOWN_STAPLES = new Set([
  'brown_rice', 'millet', 'quinoa',
  'whole_wheat', 'bread_whole_wheat',
  'gluten_free_pasta', 'oats'
]);

async function optimizeStaples(recipe, user, audit) {
  const healthSet = new Set((user.health_issues || []).map(s => String(s).toLowerCase()));
  const wantsDiabetesSwap = healthSet.has('diabetes');
  if (!wantsDiabetesSwap) return;

  const allowedStaples = new Set(recipe.staple_options || []);
  const stapleIngs = (recipe.ingredients || []).filter(i => i.staple_slot);

  for (const ing of stapleIngs) {
    const current = ing.slug;
    const prefs = STAPLE_PREFS_BY_CONDITION.diabetes[current];
    if (!prefs || !prefs.length) continue;

    // 1) Prefer items explicitly allowed by the recipe
    for (const cand of prefs) {
      if (allowedStaples.has(cand)) {
        ing.slug = cand;
        audit.swaps.push({ from: current, to: cand, reason: 'staple_pref_diabetes' });
        break;
      }
    }
    if (ing.slug !== current) continue;

    // 2) Try ingredient-level substitutes if present
    const curDoc = await Ingredient.findOne({ slug: current }).lean();
    const subs = new Set(curDoc?.substitutes || []);
    for (const cand of prefs) {
      if (subs.has(cand)) {
        ing.slug = cand;
        audit.swaps.push({ from: current, to: cand, reason: 'staple_pref_diabetes_sub' });
        break;
      }
    }
    if (ing.slug !== current) continue;

    // 3) Final fallback: swap to a safe-known staple (no DB change needed)
    for (const cand of prefs) {
      if (SAFE_KNOWN_STAPLES.has(cand)) {
        ing.slug = cand;
        audit.swaps.push({ from: current, to: cand, reason: 'staple_pref_diabetes_fallback' });
        break;
      }
    }
  }
}

async function applySubstitutions(recipe, user) {
  const dislikes = new Set(user.dislikes || []);
  const healthSlugs = user.health_issues || [];

  const healthDocs = await HealthCondition.find({ slug: { $in: healthSlugs } }).lean();
  const forbidden = new Set();
  healthDocs.forEach(h => (h.forbidden || []).forEach(f => forbidden.add(f)));

  const need = Array.from(new Set(recipe.ingredients.map(i => i.slug)));
  const ingDocs = await Ingredient.find({ slug: { $in: need } }).lean();
  const ingMap = Object.fromEntries(ingDocs.map(d => [d.slug, d]));

  const swaps = [];
  const hidden = [];
  const blocked = [];
  const newRecipe = JSON.parse(JSON.stringify(recipe));

  for (const ing of newRecipe.ingredients) {
    const slug = ing.slug;
    const imp = ing.importance ?? 1;

    if (forbidden.has(slug)) {
      const subs = (ingMap[slug]?.substitutes || []);
      let done = false;
      for (const s of subs) {
        if (forbidden.has(s)) continue;
        if (dislikes.has(s)) continue;
        ing.slug = s;
        swaps.push({ from: slug, to: s, reason: 'health_forbidden' });
        done = true; break;
      }
      if (!done) blocked.push({ ingredient: slug, reason: 'health_forbidden_no_sub' });
      continue;
    }

    if (dislikes.has(slug)) {
      if (ing.optional || imp <= 2) {
        hidden.push(slug);
        ing._hidden = true;
      } else {
        const subs = (ingMap[slug]?.substitutes || []);
        let done = false;
        for (const s of subs) {
          if (dislikes.has(s) || forbidden.has(s)) continue;
          ing.slug = s;
          swaps.push({ from: slug, to: s, reason: 'user_dislike' });
          done = true; break;
        }
        if (!done) blocked.push({ ingredient: slug, reason: 'dislike_no_sub' });
      }
    }
  }

  await optimizeStaples(newRecipe, user, { swaps, hidden, blocked });

  const ok = blocked.length === 0;
  return { ok, newRecipe, swaps, hidden, blocked };
}

module.exports = { applySubstitutions };
