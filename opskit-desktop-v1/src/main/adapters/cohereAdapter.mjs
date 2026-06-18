import { documentsAsCohereDocuments } from '../services/contextAssembler.mjs';

const COHERE_CHAT_URL = 'https://api.cohere.com/v2/chat';

export const cohereAdapter = {
  name: 'cohere',
  async send({ apiKey, model, system, documents, history, userMessage, temperature, maxTokens }) {
    if (!apiKey) throw new Error('Missing Cohere API key. Add it in Settings.');
    if (!model) throw new Error('Missing Cohere model name. Add it in Settings.');

    const messages = [
      { role: 'system', content: system },
      ...history.map((message) => ({ role: message.role, content: message.content })),
      { role: 'user', content: userMessage }
    ];

    // Cohere v2 replaces the v1 preamble field with a system-role message.
    // The documents array is kept native and ordered, with OpsKit_Quick_Setup.txt first.
    const payload = {
      stream: false,
      model,
      messages,
      documents: documentsAsCohereDocuments(documents),
      max_tokens: maxTokens,
      temperature
    };

    const response = await fetch(COHERE_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Client-Name': 'opskit-desktop-v1'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw await providerHttpError('Cohere', response);
    }

    const data = await response.json();
    return extractCohereText(data);
  }
};

export async function runCohereBootProbe({ apiKey, model, system, documents, temperature = 0.2, maxTokens = 1200 }) {
  const text = await cohereAdapter.send({
    apiKey,
    model,
    system,
    documents,
    history: [],
    userMessage: 'Hello',
    temperature,
    maxTokens
  });

  return {
    text,
    passed: text.includes('Ops Kit ready') && text.includes('[::📋::]{ops_kit_receipt::boot::')
  };
}

function extractCohereText(data) {
  const content = data?.message?.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (typeof data?.text === 'string') return data.text.trim();
  if (typeof data?.message === 'string') return data.message.trim();
  return JSON.stringify(data, null, 2);
}

async function providerHttpError(provider, response) {
  let detail = '';
  try {
    detail = await response.text();
  } catch {
    detail = '<unable to read error body>';
  }
  const error = new Error(`${provider} API error ${response.status}: ${detail}`);
  error.status = response.status;
  error.provider = provider;
  return error;
}
