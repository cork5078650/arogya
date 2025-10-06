function calcBMI(weightKg, heightCm) {
  const h = heightCm / 100;
  return +(weightKg / (h*h)).toFixed(2);
}

function dailyCaloriesEstimate(user) {
  const { gender, weight_kg, height_cm, age, activity = 'Sedentary', goal = 'Lose Weight' } = user;
  const w = weight_kg, h = height_cm, a = age;
  const bmr = (gender === 'Male')
    ? 10*w + 6.25*h - 5*a + 5
    : 10*w + 6.25*h - 5*a - 161;

  const factor = {
    Sedentary: 1.2, Light: 1.375, Moderate: 1.55, Active: 1.725
  }[activity] || 1.2;

  let cals = bmr * factor;
  if (goal === 'Lose Weight') cals *= 0.85;
  if (goal === 'Gain Weight') cals *= 1.15;
  return Math.round(cals);
}

function dailyProteinTarget(user) {
  const base =
    user.goal === 'Gain Weight' ? 1.6 :
    user.goal === 'Lose Weight' ? 1.4 : 1.2;
  return Math.round(base * user.weight_kg);
}

module.exports = { calcBMI, dailyCaloriesEstimate, dailyProteinTarget };
