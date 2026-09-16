import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const roots = ['src', 'supabase/functions', 'deploy'];
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.sh', '.yml', '.yaml', '.env']);
const rules = [
  { name: 'lovable-runtime', re: /lovable\.dev|LOVABLE_API_KEY|lovable-ai/i },
  { name: 'perplexity-runtime', re: /PERPLEXITY_API_KEY|api\.perplexity\.ai|perplexity/i },
  { name: 'firecrawl-runtime', re: /FIRECRAWL_API_KEY|api\.firecrawl\.dev|firecrawl/i },
  { name: 'openai-direct-runtime', re: /OPENAI_API_KEY|api\.openai\.com/i },
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
      for (const rule of rules) if (rule.re.test(text)) failures.push(`${rule.name}: ${path}`);
    }
  }
}
for (const root of roots) walk(root);
if (failures.length) {
  console.error('NEXUS AI GOVERNANCE AUDIT FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('NEXUS AI GOVERNANCE AUDIT PASSED: Gemini/Groq architecture has no forbidden direct runtime providers.');
