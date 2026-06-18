import path from 'node:path';
import { PROVIDERS, SUPPORTED_FILE_EXTENSIONS } from './defaults.mjs';

export function isSupportedProvider(provider) {
  return provider === PROVIDERS.COHERE || provider === PROVIDERS.CLAUDE;
}

export function isSupportedAttachment(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return SUPPORTED_FILE_EXTENSIONS.includes(ext);
}

export function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function clampFloat(value, min, max, fallback) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
