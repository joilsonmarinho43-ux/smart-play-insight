import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const roots = ['src', 'supabase/functions'];
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx']);
const rules = [
  { name: 'order-execution', re: /\b(?:place|submit|execute|create)(?:Bet|Order|Trade)\b/i },
  { name: 'cashout', re: /\bcash[_-]?out\b/i },
  { name: 'liability', re: /\bliability\b/i },
  { name: 'exchange-execution', re: /\b(?:betfair|exchangeApi|tradingApi|tradingClient)\b/i },
  { name: 'legacy-execution-engine', re: /\b(?:sniperEngine|hybridEngine|LIVE TRADER PRO)\b/i },
];

const failures = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git'].includes(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path);
    else if (extensions.has(extname(name))) {
      const text = readFileSync(path, 'utf8');
      for (const rule of rules) {
        if (rule.re.test(text)) failures.push(`${rule.name}: ${path}`);
      }
    }
  }
}

for (const root of roots) walk(root);
if (failures.length) {
  console.error('NEXUS GOVERNANCE AUDIT FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('NEXUS GOVERNANCE AUDIT PASSED: no execution primitives or legacy trading engines found.');
