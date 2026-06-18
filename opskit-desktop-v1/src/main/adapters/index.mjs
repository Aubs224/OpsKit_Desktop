import { cohereAdapter } from './cohereAdapter.mjs';
import { claudeAdapter } from './claudeAdapter.mjs';
import { PROVIDERS } from '../../shared/defaults.mjs';

export function getProviderAdapter(provider) {
  if (provider === PROVIDERS.COHERE) return cohereAdapter;
  if (provider === PROVIDERS.CLAUDE) return claudeAdapter;
  throw new Error(`Unsupported provider: ${provider}`);
}
