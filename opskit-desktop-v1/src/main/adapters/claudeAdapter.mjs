import Anthropic from '@anthropic-ai/sdk';
import { documentsAsSystemAppendix } from '../services/contextAssembler.mjs';

export const claudeAdapter = {
  name: 'claude',
  async send({ apiKey, model, system, documents, history, userMessage, temperature, maxTokens }) {
    if (!apiKey) throw new Error('Missing Claude API key. Add it in Settings.');
    if (!model) throw new Error('Missing Claude model name. Add it in Settings.');

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: `${system}${documentsAsSystemAppendix(documents)}`,
      messages: [
        ...history.map((message) => ({ role: message.role, content: message.content })),
        { role: 'user', content: userMessage }
      ]
    });

    return extractClaudeText(response);
  }
};

function extractClaudeText(response) {
  const content = response?.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part?.type === 'text' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return JSON.stringify(response, null, 2);
}
