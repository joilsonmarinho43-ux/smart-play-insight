// =============================
// TIPAGEM BASE
// =============================
type Stats = {
  goalsFor: number;
  goalsAgainst: number;
};

// =============================
// PROTEÇÃO DIVISÃO (EVITA BUG)
// =============================
function safeDivide(a: number, b: number) {
  if (!b || b === 0) return 1;
  return a / b;
}

// =============================
// 🔥 PASSO 2 - FORÇA DE ATAQUE
// =============================
export function calculateStrength(match: any) {
  const home = match?.homeStats;
  const away = match?.awayStats;

  if (!home || !away) return null;

  const attackHome = safeDivide(home.goalsFor, away.goalsAgainst);
  const attackAway = safeDivide(away.goalsFor, home.goalsAgainst);

  return {
    attackHome,
    attackAway,
  };
}

// =============================
// 🔥 PASSO 3 - POISSON (BASE REAL)
// =============================
function factorial(n: number): number {
  if (n === 0) return 1;
  return n * factorial(n - 1);
}

function poisson(lambda: number, k: number) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

// =============================
// 🔥 PROBABILIDADES REAIS
// =============================
function probOver15(homeLambda: number, awayLambda: number) {
  let prob = 0;

  for (let i = 0; i <= 5; i++) {
    for (let j = 0; j <= 5; j++) {
      if (i + j > 1) {
        prob += poisson(homeLambda, i) * poisson(awayLambda, j);
      }
    }
  }

  return prob;
}

function probOver25(homeLambda: number, awayLambda: number) {
  let prob = 0;

  for (let i = 0; i <= 5; i++) {
    for (let j = 0; j <= 5; j++) {
      if (i + j > 2) {
        prob += poisson(homeLambda, i) * poisson(awayLambda, j);
      }
    }
  }

  return prob;
}

function probBTTS(homeLambda: number, awayLambda: number) {
  const homeNoGoal = Math.exp(-homeLambda);
  const awayNoGoal = Math.exp(-awayLambda);

  return 1 - homeNoGoal - awayNoGoal + homeNoGoal * awayNoGoal;
}

// =============================
// 🔥 FUNÇÃO PRINCIPAL DO BINGO
// =============================
export function generatePreGameBingo(match: any) {
  const home = match?.homeStats;
  const away = match?.awayStats;

  if (!home || !away) {
    return null;
  }

  // 🔥 FORÇA AJUSTADA (PASSO 2)
  const strength = calculateStrength(match);

  if (!strength) return null;

  // 🔥 EXPECTATIVA DE GOLS (BASE CASA DE APOSTA)
  const homeLambda = home.goalsFor * strength.attackHome;
  const awayLambda = away.goalsFor * strength.attackAway;

  // 🔥 PROBABILIDADES REAIS
  const over15 = probOver15(homeLambda, awayLambda);
  const over25 = probOver25(homeLambda, awayLambda);
  const btts = probBTTS(homeLambda, awayLambda);

  return {
    over15: (over15 * 100).toFixed(1),
    over25: (over25 * 100).toFixed(1),
    btts: (btts * 100).toFixed(1),

    // 🔥 EXTRA (DEBUG / PROFISSIONAL)
    homeLambda: homeLambda.toFixed(2),
    awayLambda: awayLambda.toFixed(2),
  };
}
