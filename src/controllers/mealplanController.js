// src/controllers/mealplanController.js
const mongoose = require('mongoose');

/* =========================
   Tunable constants
   ========================= */
const TOP_K = 5;                 
const PASS1_KCAL_TOL = 0.12;     
const PASS1_PROT_TOL = 0.20;     
const PASS2_KCAL_TOL = 0.40;     
const PASS2_PROT_TOL = 0.50;     
const W_CAL = 0.75;              
const W_PRO = 0.25;              
const PENALTY_DISLIKE = 0.06;    
const PENALTY_MISSING_PROT = 0.10; 

/* =========================
   Helpers
   ========================= */
const lc = s => String(s || '').toLowerCase();
const toTitle = s => String(s || '').replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
const randInt = n => Math.floor(Math.random() * n);
function cmToM(cm){ return (cm || 0)/100; }
function calcBMI({ height_cm=0, weight_kg=0 }) {
  const m = cmToM(height_cm); if(!m) return 0;
  return +(weight_kg/(m*m)).toFixed(2);
}
function calcDailyCalories({ gender, age, height_cm, weight_kg, activity, goal }) {
  const w = +weight_kg || 0, h = +height_cm || 0, a = +age || 0;
  let bmr = lc(gender)==='male'
    ? 88.362 + 13.397*w + 4.799*h - 5.677*a
    : 447.593 + 9.247*w + 3.098*h - 4.330*a;
  const mult = ({'sedentary':1.2,'lightly active':1.375,'moderately active':1.55,'very active':1.725}[lc(activity)]) || 1.2;
  let tdee = bmr * mult;
  const g = lc(goal); if(g==='lose weight') tdee -= 500; if(g==='gain weight') tdee += 500;
  return Math.max(1200, Math.round(tdee));
}
function calcDailyProtein({ weight_kg, activity, goal }) {
  const active = ['moderately active','very active'].includes(lc(activity));
  const gaining = lc(goal)==='gain weight';
  const perKg = (active||gaining) ? 1.6 : 1.2;
  return Math.max(50, Math.round((+weight_kg||0)*perKg));
}

// ✅ Breakfast & Snack boosted
function slotTargets(dailyCal){
  return {
    Breakfast: Math.round(dailyCal*0.25),
    Lunch:     Math.round(dailyCal*0.35),
    Snack:     Math.round(dailyCal*0.15),
    Dinner:    Math.round(dailyCal*0.25),
  };
}

function lowerArray(a=[]){ return a.map(s=>lc(s)).filter(Boolean); }
function uniq(arr){ return [...new Set(arr)]; }
function stripMd(s){ return String(s||'').replace(/\*\*([^*]+)\*\*/g,'$1'); }

/* =========================
   DB lookups
   ========================= */
async function getHealthMaps(healthSlugs){
  if(!healthSlugs?.length) return { forbiddenSet:new Set(), cautionSet:new Set() };
  const coll = mongoose.connection.db.collection('health_conditions');
  const conds = await coll.find({ slug:{ $in: healthSlugs } })
    .project({ forbidden:1, caution:1 }).toArray();
  const f=[], c=[];
  conds.forEach(h=>{
    (h?.forbidden||[]).forEach(x=>f.push(lc(x)));
    (h?.caution||[]).forEach(x=>c.push(lc(x)));
  });
  return { forbiddenSet:new Set(f), cautionSet:new Set(c) };
}

async function getIngredientSubsMap(slugsNeeded=[]){
  if(!slugsNeeded.length) return {};
  const Ingredients = mongoose.connection.db.collection('ingredients');
  const docs = await Ingredients.find({ slug:{ $in: slugsNeeded } })
    .project({ slug:1, substitutes:1 }).toArray();
  const map={};
  docs.forEach(d=>{
    map[lc(d.slug)] = (d.substitutes||[]).map(s=>lc(s));
  });
  return map;
}

/* =========================
   Sanitize free text
   ========================= */
function sanitizeFreeText(text, subMap, omitSet){
  if(!text) return text;
  const replacementMap = {};

  Object.keys(subMap||{}).forEach(originalSlug => {
    const replacementSlug = subMap[originalSlug];
    const replacementName = toTitle(replacementSlug);
    [originalSlug, originalSlug.replace(/_/g, ' ')].forEach(name=>{
      replacementMap[lc(name)] = replacementName;
      replacementMap[lc(name+'s')] = replacementName;
    });
  });

  [ ...(omitSet ? Array.from(omitSet) : []) ].forEach(omittedSlug => {
    [omittedSlug, omittedSlug.replace(/_/g,' ')].forEach(name=>{
      replacementMap[lc(name)] = '';
      replacementMap[lc(name+'s')] = '';
    });
  });

  const keys = Object.keys(replacementMap).filter(k => replacementMap[k] !== undefined);
  if(!keys.length) return stripMd(text);

  const pats = keys.map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
  const rx = new RegExp(`\\b(${pats.join('|')})\\b`, 'gi');

  return stripMd(
    text.replace(rx, (m)=>{
      const key = lc(m).replace(/ /g,'_');
      const replacement = replacementMap[key] || '';
      return replacement ? replacement : ' ';
    }).replace(/\s+/g, ' ').trim()
  );
}

/* =========================
   Scoring & selection
   ========================= */
function isNonVegTag(tag) {
  const t = lc(tag || '');
  return t.includes('non') && t.includes('veg');
}

function fitsTolerance(r, kcalTarget, protTarget, kcalTol, protTol, slot){
  let upperTol = kcalTol;
  if (slot === 'Breakfast' || slot === 'Snack') upperTol = 0.80;
  const kcalOk = Math.abs((r.calories - kcalTarget) / (kcalTarget || 1)) <= upperTol;
  const proOk  = Math.abs(((r.protein||0) - protTarget) / (protTarget || 1)) <= protTol;
  return kcalOk && proOk;
}

function scoreRecipe(r, kcalTarget, protTarget, dislikeSet){
  const kcalErr = Math.abs((r.calories - kcalTarget) / (kcalTarget || 1));
  const protVal = (r.protein || 0);
  const protErr = Math.abs((protVal - protTarget) / (protTarget || 1));
  const dislikeCount = (r.ingredients||[]).reduce((a,i)=>a + (dislikeSet.has(lc(i.slug)) ? 1 : 0), 0);
  const missingProtPenalty = protVal ? 0 : PENALTY_MISSING_PROT;
  return W_CAL*(kcalErr*kcalErr) + W_PRO*(protErr*protErr) + dislikeCount*PENALTY_DISLIKE + missingProtPenalty;
}

async function selectForSlot({
  slot, kcalTarget, proteinTarget, dislikes, forbiddenSet, cautionSet, foodPref, excludeSlugs
}){
  const Recipes = mongoose.connection.db.collection('recipes');

  const baseQuery = {
    meal_type: { $regex: new RegExp(`^${(slot||'').trim()}$`,'i') }
  };

  const pref = lc(foodPref);
  if (pref==='vegetarian') baseQuery.dietaryType = { $in:['Vegetarian','Vegan'] };
  if (pref==='vegan')      baseQuery.dietaryType = 'Vegan';

  let pool = await Recipes.find(baseQuery).project({
    _id:0,
    slug:1, recipe_name:1, meal_type:1,
    calories:1, protein:1, carbs:1, fats:1,
    time_minutes:1, dietaryType:1,
    tags:1, image_url:1,
    ingredients:1, steps:1, notes:1
  }).limit(1000).toArray();
  if(!pool.length) return null;

  pool = pool.map(r => ({
    ...r,
    calories: +r.calories || 0,
    protein:  +r.protein  || 0,
    carbs:    +r.carbs    || 0,
    fats:     +r.fats     || 0
  }));

  const excludeSet = new Set((excludeSlugs||[]).map(lc));
  pool = pool.filter(r => !excludeSet.has(lc(r.slug)));
  if(!pool.length) return null;

  const hardBlock = new Set(forbiddenSet);
  let strict = pool.filter(r => !(r.ingredients||[]).some(i => hardBlock.has(lc(i.slug))));
  if(!strict.length) strict = pool;

  const dislikeSet = new Set(dislikes);
  const caution = new Set(cautionSet);

  let candidates = strict.filter(r => fitsTolerance(r, kcalTarget, proteinTarget, PASS1_KCAL_TOL, PASS1_PROT_TOL, slot));
  if(!candidates.length){
    candidates = strict.filter(r => fitsTolerance(r, kcalTarget, proteinTarget, PASS2_KCAL_TOL, PASS2_PROT_TOL, slot));
  }
  if(!candidates.length) candidates = strict.slice();

  let scored = candidates.map(r => ({ r, s: scoreRecipe(r, kcalTarget, proteinTarget, dislikeSet) }))
                         .sort((a,b)=>a.s-b.s);

  const preferNonVeg = lc(foodPref) === 'non-vegetarian' || lc(foodPref) === 'non vegetarian';
  if (preferNonVeg && scored.length) {
    const nonVeg = [], veg = [];
    for (const item of scored) {
      if (isNonVegTag(item.r.dietaryType)) nonVeg.push(item); else veg.push(item);
    }
    scored = nonVeg.concat(veg);
  }

  const pick = scored.length ? scored[Math.min(randInt(TOP_K), scored.length-1)].r : null;
  if(!pick) return null;

  const dislikedInChosen = (pick.ingredients||[]).filter(i => dislikeSet.has(lc(i.slug)));
  const cautionInChosen = (pick.ingredients||[]).filter(i => caution.has(lc(i.slug)));

  const subsMapRaw = await getIngredientSubsMap(dislikedInChosen.map(i => lc(i.slug)));
  const cautionSubsRaw = await getIngredientSubsMap(cautionInChosen.map(i => lc(i.slug)));

  const subMap = {};
  Object.keys(subsMapRaw).forEach(k => {
    const list = subsMapRaw[k] || [];
    if(list.length) subMap[k] = list[0];
  });

  const cautionSubsMap = {};
  Object.keys(cautionSubsRaw).forEach(k => {
    const list = cautionSubsRaw[k] || [];
    if(list.length) cautionSubsMap[k] = list; // show all options for user
  });

  const hidden=[], cautionMarks=[], substitutes=[];
  pick.ingredients = (pick.ingredients||[]).map(i=>{
    const s = lc(i.slug);
    if(hardBlock.has(s)){ hidden.push(s); return { ...i, _hidden:true }; }
    if(caution.has(s)){ 
      cautionMarks.push(s); 
      return { ...i, _caution:true, caution_subs: cautionSubsMap[s] || [] }; 
    }
    if(dislikeSet.has(s) && subMap[s]){
      substitutes.push(`${s}->${subMap[s]}`);
      return { ...i, substituted:true, substitute_slug: subMap[s] };
    }
    return i;
  });

  const omitSet = new Set([
    ...Array.from(hardBlock),
    ...dislikedInChosen.map(i=>lc(i.slug)).filter(s=>!subMap[s])
  ]);
  const cleanedSteps = (pick.steps||[]).map(t=>sanitizeFreeText(t, subMap, omitSet));
  const cleanedNotes = sanitizeFreeText(pick.notes||'', subMap, omitSet);

  return {
    recipe: { ...pick, steps: cleanedSteps, notes: cleanedNotes },
    hidden: uniq(hidden),
    cautions: uniq(cautionMarks),
    substitutes: uniq(substitutes),
    cautionSubs: cautionSubsMap
  };
}

/* =========================
   Builder
   ========================= */
async function buildMealPlan(payload){
  const user = payload.user || {};
  const gender = user.gender || 'Female';
  const age = +user.age || 25;
  const height_cm = +user.height_cm || 165;
  const weight_kg = +user.weight_kg || 65;
  const activity = user.activity || 'Sedentary';
  const goal = user.goal || 'Maintain Weight';
  const foodPref = user.food_preference || 'Vegetarian';

  const dislikes = lowerArray(user.dislikes || []);
  const health_issues = lowerArray(user.health_issues || []);

  const recentSlugs = payload.recentSlugs || {};
  const { forbiddenSet, cautionSet } = await getHealthMaps(health_issues);

  const dailyCal = user.calories ? Math.round(+user.calories) 
                                 : calcDailyCalories({ gender, age, height_cm, weight_kg, activity, goal });
  const dailyProtein = user.protein ? Math.round(+user.protein)
                                    : calcDailyProtein({ weight_kg, activity, goal });

  const bmi = calcBMI({ height_cm, weight_kg });
  const targets = slotTargets(dailyCal);
  const proteinShare = { Breakfast:0.25, Lunch:0.35, Snack:0.15, Dinner:0.25 };

  const slots = ['Breakfast','Lunch','Snack','Dinner'];
  const mealPlan = {};
  const nextRecent = {};
  const audit = { hidden:{}, cautions:{}, substitutes:{}, cautionSubs:{}, blocked:[] };

  for(const slot of slots){
    const kcalTarget = targets[slot];
    const pTarget = Math.round(dailyProtein * (proteinShare[slot] || 0.25));
    const excludeSlugs = recentSlugs[slot] || [];

    const pick = await selectForSlot({
      slot, kcalTarget, proteinTarget: pTarget,
      dislikes, forbiddenSet, cautionSet, foodPref, excludeSlugs
    });

    if(pick?.recipe){
      const slug = pick.recipe.slug;
      mealPlan[slot] = pick;

      const prev = excludeSlugs.filter(s => s !== slug);
      prev.unshift(slug);
      if (prev.length > 5) prev.pop();
      nextRecent[slot] = prev;

      audit.hidden[slot] = pick.hidden;
      audit.cautions[slot] = pick.cautions;
      audit.substitutes[slot] = pick.substitutes;
      audit.cautionSubs[slot] = pick.cautionSubs;
    } else {
      mealPlan[slot] = { recipe:null };
      nextRecent[slot] = excludeSlugs;
      audit.blocked.push(slot);
    }
  }

  return { ok:true, bmi, dailyCal, dailyProtein, targetPerSlot:targets, mealPlan, audit, recentSlugs: nextRecent };
}

module.exports = { buildMealPlan };

