// Built-in recipe library used when no ANTHROPIC_API_KEY is set ("demo mode"). It uses the same recipe shape
// as the AI, so the cascade, grocery list and UI behave identically. Ingredients are shared between recipes on
// purpose, so choosing one recipe visibly changes what the next suggestions look like.
import { sanitizeRecipe } from './recipes.js';
import { fmtQty } from '../public/js/units.js';
import { keyOf, normName } from './cascade.js';

// name: [unit, aisle, packSize, packLabel, shelfLifeDays]   (null pack = staple)
const CATALOG = {
  apple: ['count', 'produce', 6, 'bag of apples (about 6)', 28],
  banana: ['count', 'produce', 5, 'bunch of bananas (about 5)', 5],
  'baby spinach': ['g', 'produce', 142, '5 oz bag baby spinach', 6],
  tomato: ['count', 'produce', 4, 'pack of 4 tomatoes', 7],
  onion: ['count', 'produce', 3, 'bag of yellow onions (3)', 30],
  'bell pepper': ['count', 'produce', 3, '3-pack bell peppers', 10],
  avocado: ['count', 'produce', 4, 'bag of 4 avocados', 4],
  lemon: ['count', 'produce', 4, 'bag of lemons (4)', 21],
  cucumber: ['count', 'produce', 2, '2 cucumbers', 7],
  carrot: ['g', 'produce', 454, '1 lb bag carrots', 21],
  broccoli: ['g', 'produce', 340, 'large broccoli crown (12 oz)', 7],
  'romaine lettuce': ['g', 'produce', 300, 'head of romaine', 7],
  potato: ['count', 'produce', 5, 'bag of potatoes (5)', 30],
  'garlic clove': ['count', 'produce', 10, 'head of garlic (about 10 cloves)', 30],
  blueberry: ['g', 'produce', 170, 'pint of blueberries', 7],
  egg: ['count', 'dairy & eggs', 12, 'dozen eggs', 21],
  milk: ['ml', 'dairy & eggs', 1893, 'half gallon milk', 7],
  'greek yogurt': ['g', 'dairy & eggs', 907, '32 oz tub Greek yogurt', 14],
  'cheddar cheese': ['g', 'dairy & eggs', 227, '8 oz block cheddar', 30],
  'chicken breast': ['g', 'meat & seafood', 454, '1 lb chicken breast', 3],
  'ground turkey': ['g', 'meat & seafood', 454, '1 lb ground turkey', 3],
  'salmon fillet': ['g', 'meat & seafood', 340, '12 oz salmon fillets (2)', 2],
  bread: ['count', 'bakery', 20, 'loaf of sandwich bread (20 slices)', 7],
  'flour tortilla': ['count', 'bakery', 8, 'pack of 8 tortillas', 14],
  'rolled oat': ['g', 'pantry', 510, 'canister rolled oats', 365],
  rice: ['g', 'pantry', 907, '2 lb bag rice', 365],
  pasta: ['g', 'pantry', 454, '1 lb box pasta', 730],
  'black bean': ['g', 'pantry', 425, '15 oz can black beans', 730],
  'canned tomato': ['g', 'pantry', 400, '14 oz can diced tomatoes', 730],
  'peanut butter': ['g', 'pantry', 340, '12 oz jar peanut butter', 180],
  hummus: ['g', 'pantry', 283, '10 oz tub hummus', 14],
  salsa: ['g', 'pantry', 454, '16 oz jar salsa', 60],
  // staples
  'olive oil': null, salt: null, 'black pepper': null, cinnamon: null, cumin: null, 'soy sauce': null, 'chili powder': null,
};
const STAPLE_AISLE = 'pantry';

// R(meal, title, minutes, protein, description, ingredients[[name, amountFor2, note?]], steps[])
const R = (meal, title, minutes, protein, description, ingredients, steps) => ({ meal, title, minutes, protein, description, ingredients, steps });
const STAPLE_AMOUNT = { 'olive oil': [15, 'ml'], salt: [1, 'count'], 'black pepper': [1, 'count'], cinnamon: [1, 'count'], cumin: [1, 'count'], 'soy sauce': [30, 'ml'], 'chili powder': [1, 'count'] };

const LIBRARY = [
  R('breakfast', 'Spinach & tomato scramble on toast', 12, 'egg', 'Fluffy eggs with wilted spinach and juicy tomato on buttered toast.',
    [['egg', 4], ['baby spinach', 60], ['tomato', 1, 'diced'], ['bread', 2, 'toasted'], ['olive oil'], ['salt'], ['black pepper']],
    ['Whisk the eggs with a pinch of salt and pepper.', 'Heat the olive oil in a pan over medium heat and soften the tomato for 2 minutes.', 'Add the spinach and stir until wilted, about 1 minute.', 'Pour in the eggs and stir gently until just set.', 'Serve over the toast.']),
  R('breakfast', 'Apple cinnamon overnight oats', 5, 'oats', 'Creamy oats soaked overnight with grated apple and cinnamon.',
    [['rolled oat', 80], ['milk', 240], ['apple', 1, 'grated'], ['cinnamon'], ['peanut butter', 20]],
    ['Stir oats, milk and cinnamon together in a jar.', 'Grate in the apple and mix well.', 'Cover and refrigerate overnight (or at least 4 hours).', 'Top with a spoonful of peanut butter and serve cold or warmed.']),
  R('breakfast', 'Berry banana yogurt parfait', 5, 'yogurt', 'Layers of Greek yogurt, blueberries, banana and crunchy oats.',
    [['greek yogurt', 300], ['banana', 1, 'sliced'], ['blueberry', 100], ['rolled oat', 30, 'toasted']],
    ['Toast the oats in a dry pan for 3 minutes until golden.', 'Layer yogurt, banana and blueberries in two glasses.', 'Finish with the toasted oats.']),
  R('breakfast', 'Two-ingredient banana pancakes', 15, 'banana', 'Naturally sweet pancakes from mashed banana, egg and oats.',
    [['banana', 2, 'mashed'], ['egg', 2], ['rolled oat', 80], ['milk', 60], ['olive oil']],
    ['Blend or mash the bananas, eggs, oats and milk into a thick batter.', 'Heat a lightly oiled pan over medium heat.', 'Cook spoonfuls of batter 2 to 3 minutes per side until golden.', 'Serve warm.']),
  R('breakfast', 'Black bean breakfast burritos', 20, 'beans', 'Scrambled egg, black beans, pepper and cheddar rolled in a warm tortilla.',
    [['egg', 4], ['flour tortilla', 2], ['black bean', 130], ['cheddar cheese', 50], ['salsa', 60], ['bell pepper', 1, 'diced'], ['olive oil'], ['cumin']],
    ['Soften the pepper in oil for 3 minutes, then add the beans and cumin.', 'Scramble in the eggs until just set.', 'Warm the tortillas, then fill with the egg mixture, cheddar and salsa.', 'Fold in the sides and roll up.']),

  R('lunch', 'Chicken & romaine wraps', 15, 'chicken', 'Pan-seared chicken with crisp romaine, tomato and a yogurt dressing in a tortilla.',
    [['chicken breast', 225], ['flour tortilla', 2], ['romaine lettuce', 100], ['tomato', 1, 'sliced'], ['greek yogurt', 60], ['olive oil'], ['salt'], ['black pepper']],
    ['Season the chicken and sear in oil for 5 to 6 minutes per side until cooked through; rest and slice.', 'Stir the yogurt with a pinch of salt and pepper.', 'Pile lettuce, tomato and chicken on each tortilla, drizzle with yogurt dressing and wrap.']),
  R('lunch', 'Spinach, apple & cheddar salad', 10, 'cheese', 'A fresh salad with crisp apple, sharp cheddar and a lemon dressing, with toast on the side.',
    [['baby spinach', 120], ['apple', 1, 'thinly sliced'], ['cheddar cheese', 50, 'cubed'], ['lemon', 1, 'juiced'], ['bread', 2, 'toasted'], ['olive oil'], ['salt']],
    ['Whisk lemon juice, olive oil and a pinch of salt for the dressing.', 'Toss spinach, apple and cheddar with the dressing.', 'Serve with the toast.']),
  R('lunch', 'Black bean & rice burrito bowls', 20, 'beans', 'Rice, seasoned beans, pepper, avocado and salsa in a bowl.',
    [['rice', 150], ['black bean', 255], ['bell pepper', 1, 'diced'], ['avocado', 1, 'sliced'], ['salsa', 60], ['lemon', 1, 'juiced'], ['cumin'], ['olive oil']],
    ['Cook the rice according to the packet.', 'Warm the beans with cumin and the diced pepper in a little oil for 5 minutes.', 'Divide the rice between bowls and top with beans, avocado and salsa.', 'Finish with a squeeze of lemon.']),
  R('lunch', 'Tomato soup & grilled cheese', 25, 'cheese', 'Silky tomato soup with golden cheddar sandwiches for dunking.',
    [['canned tomato', 400], ['onion', 1, 'chopped'], ['bread', 4], ['cheddar cheese', 100], ['olive oil'], ['salt'], ['black pepper']],
    ['Soften the onion in oil for 5 minutes, add the tomatoes and a cup of water and simmer for 15 minutes.', 'Blend the soup smooth and season with salt and pepper.', 'Make sandwiches with the cheddar and toast in a pan until golden on both sides.', 'Serve the soup with the sandwiches.']),
  R('lunch', 'Hummus veggie pita plate', 10, 'hummus', 'Hummus with crunchy cucumber and carrot sticks and warm tortilla "pita".',
    [['hummus', 140], ['cucumber', 1, 'sliced'], ['carrot', 100, 'cut into sticks'], ['flour tortilla', 2, 'warmed']],
    ['Cut the vegetables.', 'Warm the tortillas in a dry pan for 30 seconds per side.', 'Serve everything together on a plate with the hummus.']),

  R('dinner', 'Lemon-garlic chicken with roasted broccoli & potatoes', 40, 'chicken', 'Sheet-pan chicken with garlic and lemon, roasted with broccoli and crispy potatoes.',
    [['chicken breast', 450], ['broccoli', 340], ['potato', 3, 'cubed'], ['lemon', 1], ['garlic clove', 3, 'minced'], ['olive oil'], ['salt'], ['black pepper']],
    ['Heat the oven to 425°F (220°C).', 'Toss the potatoes with oil, salt and pepper and roast for 15 minutes.', 'Add the broccoli and chicken, rubbed with garlic, lemon juice and oil, to the tray.', 'Roast 20 more minutes until the chicken reaches 165°F (74°C).', 'Squeeze over more lemon to serve.']),
  R('dinner', 'Turkey taco bowls', 30, 'turkey', 'Spiced ground turkey over rice with beans, tomato, avocado and lettuce.',
    [['ground turkey', 454], ['rice', 150], ['black bean', 255], ['tomato', 2, 'diced'], ['avocado', 1], ['romaine lettuce', 100, 'shredded'], ['cheddar cheese', 50, 'grated'], ['chili powder'], ['cumin'], ['olive oil']],
    ['Cook the rice according to the packet.', 'Brown the turkey in oil, breaking it up, then stir in chili powder, cumin and a splash of water.', 'Warm the beans.', 'Build bowls with rice, turkey, beans, tomato, lettuce, avocado and cheddar.']),
  R('dinner', 'Lemon salmon with rice & garlicky spinach', 25, 'salmon', 'Pan-seared salmon with fluffy rice and quick garlic spinach.',
    [['salmon fillet', 340], ['rice', 150], ['baby spinach', 140], ['lemon', 1], ['garlic clove', 2, 'sliced'], ['olive oil'], ['salt'], ['black pepper']],
    ['Cook the rice according to the packet.', 'Season the salmon and sear skin-side down in oil for 4 minutes, flip and cook 3 more.', 'In another pan, sizzle the garlic in oil, then wilt in the spinach.', 'Serve the salmon over rice with spinach and lemon wedges.']),
  R('dinner', 'Pasta pomodoro with spinach', 25, 'pasta', 'Simple tomato-garlic pasta with a handful of wilted spinach.',
    [['pasta', 225], ['canned tomato', 400], ['onion', 1, 'diced'], ['garlic clove', 2, 'minced'], ['baby spinach', 60], ['olive oil'], ['salt'], ['black pepper']],
    ['Boil the pasta in salted water until al dente.', 'Soften the onion and garlic in oil for 4 minutes, add the tomatoes and simmer 12 minutes.', 'Stir in the spinach until wilted.', 'Toss with the drained pasta and season to taste.']),
  R('dinner', 'Chicken & vegetable stir-fry', 25, 'chicken', 'Quick chicken stir-fry with peppers, broccoli and carrot over rice.',
    [['chicken breast', 340, 'sliced'], ['bell pepper', 2, 'sliced'], ['broccoli', 200], ['carrot', 150, 'sliced'], ['rice', 150], ['onion', 1, 'sliced'], ['garlic clove', 2, 'minced'], ['soy sauce'], ['olive oil']],
    ['Cook the rice according to the packet.', 'Stir-fry the chicken in hot oil for 5 minutes until browned; set aside.', 'Stir-fry the onion, carrot and broccoli for 4 minutes, then the pepper and garlic for 2.', 'Return the chicken, add the soy sauce and toss for a minute.', 'Serve over the rice.']),
  R('dinner', 'Turkey-stuffed peppers', 45, 'turkey', 'Bell peppers baked with a savoury turkey, rice and tomato filling and melted cheddar.',
    [['ground turkey', 340], ['bell pepper', 3, 'halved and seeded'], ['rice', 100], ['tomato', 1, 'diced'], ['onion', 1, 'diced'], ['cheddar cheese', 50, 'grated'], ['olive oil'], ['chili powder']],
    ['Heat the oven to 375°F (190°C) and cook the rice.', 'Brown the turkey with the onion in oil, then mix in the rice, tomato and chili powder.', 'Fill the pepper halves, cover with foil and bake 25 minutes.', 'Top with cheddar and bake 5 more minutes uncovered.']),

  R('snack', 'Apple slices with peanut butter', 3, 'peanut butter', 'Crisp apple with a scoop of peanut butter for dipping.',
    [['apple', 2, 'sliced'], ['peanut butter', 40]], ['Slice the apples.', 'Serve with the peanut butter for dipping.']),
  R('snack', 'Berry yogurt cup', 2, 'yogurt', 'Greek yogurt topped with blueberries.',
    [['greek yogurt', 200], ['blueberry', 80]], ['Spoon the yogurt into two bowls.', 'Top with the blueberries.']),
  R('snack', 'Hummus & carrot sticks', 5, 'hummus', 'Crunchy carrot sticks with creamy hummus.',
    [['hummus', 100], ['carrot', 120, 'cut into sticks']], ['Cut the carrots into sticks.', 'Serve with the hummus.']),
  R('snack', 'Banana & peanut butter toast', 5, 'banana', 'Toast spread with peanut butter and topped with sliced banana.',
    [['banana', 1, 'sliced'], ['bread', 2, 'toasted'], ['peanut butter', 30]], ['Toast the bread.', 'Spread with peanut butter and top with banana.']),
];

const roundAmount = (n, unit) => (unit === 'count' ? Math.max(0.5, Math.round(n * 2) / 2) : Math.max(5, Math.round(n / 5) * 5));

const plural = (name, n) => (n <= 1 ? name : /(tomato|potato)$/.test(name) ? `${name}es` : `${name}s`);

function build(def, servings, system) {
  const scale = servings / 2;
  const ingredients = def.ingredients.map(([name, amount, note]) => {
    const cat = CATALOG[name];
    if (cat === undefined) throw new Error(`demo catalog is missing ${name}`);
    if (cat === null) {
      const oil = STAPLE_AMOUNT[name];
      return { name, display: oil[1] === 'ml' ? `${fmtQty(oil[0], 'ml', system)} ${name}` : `${name} to taste`, amount: oil[0], unit: oil[1], aisle: STAPLE_AISLE, staple: true, pack: null };
    }
    const [unit, aisle, size, label, shelf] = cat;
    const amt = roundAmount((amount ?? 1) * scale, unit);
    const qty = fmtQty(amt, unit, system);
    let what;
    if (unit !== 'count') what = `${qty} ${name}`;
    else if (name === 'bread') what = `${qty} slice${amt > 1 ? 's' : ''} of bread`;
    else what = `${qty} ${plural(name, amt)}`;
    return { name, aisle, staple: false, amount: amt, unit, display: note ? `${what}, ${note}` : what, pack: { size, label, shelf_life_days: shelf } };
  });
  return sanitizeRecipe({ title: def.title, description: def.description, minutes: def.minutes, ingredients, steps: def.steps });
}

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };

export function createDemoRecipes() {
  return {
    enabled: true,
    demo: true,
    model: 'built-in demo recipes',
    async suggest(ctx) {
      const { meal, date, settings, priority, recent, sameDay } = ctx;
      const system = settings.units === 'metric' ? 'metric' : 'us';
      const urgent = new Map(priority.map((l) => [l.key, l]));
      const avoid = new Set([...recent, ...sameDay].map(normName));
      const pool = LIBRARY.filter((d) => d.meal === meal).map((def) => {
        const recipe = build(def, settings.servings, system);
        let score = 0;
        for (const ing of recipe.ingredients) {
          const lot = urgent.get(keyOf(ing.name, ing.unit));
          if (!lot) continue;
          const urgency = lot.days_left == null ? 1.5 : lot.days_left <= 3 ? 3 : lot.days_left <= 7 ? 2 : 1;
          score += urgency + (ing.amount <= lot.remaining ? 1 : 0);
        }
        if (avoid.has(normName(recipe.title))) score -= 20;
        return { def, recipe, score, jitter: hash(`${date}|${meal}|${def.title}|${ctx.hint || ''}|${ctx.salt || ''}`) };
      });
      const picked = [];
      const top = [...pool].sort((a, b) => b.score - a.score || a.jitter - b.jitter)[0];
      if (top && top.score > 0) picked.push(top);
      const rest = pool.filter((p) => !picked.includes(p)).sort((a, b) => (b.score * 0.4 + b.jitter) - (a.score * 0.4 + a.jitter));
      for (const p of rest) {
        if (picked.length === 3) break;
        if (picked.some((q) => q.def.protein === p.def.protein) && rest.length > 3) continue;
        picked.push(p);
      }
      for (const p of rest) { if (picked.length === 3) break; if (!picked.includes(p)) picked.push(p); }
      return picked.map((p) => p.recipe);
    },
  };
}
