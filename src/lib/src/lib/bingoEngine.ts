// =============================
// TIPAGEM BASE
// =============================
type Stats = {
  goalsFor: number;
  goalsAgainst: number;
};

// =============================
// PROTEÇÃO DIVISÃO
// =============================
function safeDivide(a: number, b: number) {
  if (!b || b === 0) return 1;
  return a / b;
}

// =============================
// 🔥 FORÇA ATAQUE
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
// 🔥 POISSON
// =============================
function factorial(n: number): number {
  if (n === 0) return 1;
  return n * factorial(n - 1);
}

function poisson(lambda: number, k: number) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

// =============================
// 🔥 PROBABILIDADES
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
// 🔥 BINGO PRÉ-JOGO
// =============================
export function generatePreGameBingo(match: any) {
  const home = match?.homeStats;
  const away = match?.awayStats;

  if (!home || !away) return null;

  const strength = calculateStrength(match);
  if (!strength) return null;

  const homeLambda = home.goalsFor * strength.attackHome;
  const awayLambda = away.goalsFor * strength.attackAway;

  const over15 = probOver15(homeLambda, awayLambda);
  const over25 = probOver25(homeLambda, awayLambda);
  const btts = probBTTS(homeLambda, awayLambda);

  return {
    over15: (over15 * 100).toFixed(1),
    over25: (over25 * 100).toFixed(1),
    btts: (btts * 100).toFixed(1),

    homeLambda: homeLambda.toFixed(2),
    awayLambda: awayLambda.toFixed(2),
  };
}

// =============================
// 🔥 MULTI-BILHETE INTELIGENTE
// =============================
type Pick = {
  match: any;
  market: string;
  probability: number;
};

function combineProbability(picks: Pick[]) {
  return picks.reduce((acc, p) => acc * (p.probability / 100), 1) * 100;
}

export function generateSmartBets(matches: any[]) {
  const allPicks: Pick[] = [];

  for (const match of matches) {
    const data = generatePreGameBingo(match);
    if (!data) continue;

    const over15 = Number(data.over15);
    const over25 = Number(data.over25);
    const btts = Number(data.btts);

    if (over15 >= 75) {
      allPicks.push({ match, market: 'Over 1.5 Gols', probability: over15 });
    }

    if (over25 >= 65) {
      allPicks.push({ match, market: 'Over 2.5 Gols', probability: over25 });
    }

    if (btts >= 60) {
      allPicks.push({ match, market: 'Ambas Marcam', probability: btts });
    }
  }

  const sorted = allPicks.sort((a, b) => b.probability - a.probability);

  const tickets: any[] = [];

  // 🔥 BILHETES 2 JOGOS
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[i].match.id === sorted[j].match.id) continue;

      const picks = [sorted[i], sorted[j]];
      const prob = combineProbability(picks);

      if (prob >= 55) {
        tickets.push({
          picks,
          probability: prob.toFixed(1),
        });
      }
    }
  }

  // 🔥 BILHETES 3 JOGOS
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      for (let k = j + 1; k < sorted.length; k++) {
        const ids = [
          sorted[i].match.id,
          sorted[j].match.id,
          sorted[k].match.id,
        ];

        if (new Set(ids).size < 3) continue;

        const picks = [sorted[i], sorted[j], sorted[k]];
        const prob = combineProbability(picks);

        if (prob >= 40) {
          tickets.push({
            picks,
            probability: prob.toFixed(1),
          });
        }
      }
    }
  }

  return tickets.slice(0, 10);
}
