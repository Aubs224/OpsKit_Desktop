import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSystemPrompt } from '../src/main/defaultSystemPrompt.mjs';
import { documentsAsCohereDocuments } from '../src/main/services/contextAssembler.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const apiKey = process.env.COHERE_API_KEY;
const model = process.env.COHERE_MODEL || 'command-a-03-2025';
const quickSetupPath = process.env.OPSKIT_QUICK_SETUP || path.join(projectRoot, 'assets', 'OpsKit_Quick_Setup.txt');

if (!apiKey) {
  console.error('Missing COHERE_API_KEY. Example: COHERE_API_KEY=... npm run test:cohere');
  process.exit(2);
}

const quickSetupText = await fs.readFile(quickSetupPath, 'utf8');
const documents = documentsAsCohereDocuments([
  { title: 'OpsKit_Quick_Setup.txt', source: quickSetupPath, layer: 1, text: quickSetupText }
]);

const payload = {
  stream: false,
  model,
  messages: [
    { role: 'system', content: buildSystemPrompt({ currentDate: new Date().toISOString().slice(0, 10), sessionSlug: 'risk-01-cohere-boot-probe' }) },
    { role: 'user', content: 'Hello' }
  ],
  documents,
  max_tokens: 1600,
  temperature: 0.2
};

const response = await fetch('https://api.cohere.com/v2/chat', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-Client-Name': 'opskit-desktop-v1-risk-01'
  },
  body: JSON.stringify(payload)
});

if (!response.ok) {
  console.error(`Cohere API error ${response.status}`);
  console.error(await response.text());
  process.exit(1);
}

const data = await response.json();
const text = extractText(data);
const passed = text.includes('Ops Kit ready') && text.includes('[::📋::]{ops_kit_receipt::boot::');
console.log(text);
console.log('\n---');
console.log(passed ? 'RISK-01 PASS' : 'RISK-01 CHECK NEEDED');
process.exit(passed ? 0 : 1);

function extractText(data) {
  return (data?.message?.content || [])
    .map((part) => (typeof part === 'string' ? part : part?.text || ''))
    .join('\n')
    .trim();
}
