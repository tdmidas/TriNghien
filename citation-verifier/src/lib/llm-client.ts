import OpenAI from 'openai';

import { hasLlmKey, llmBaseUrl } from './env';

// Returns null when no key is configured so callers degrade gracefully
// instead of crashing the route.
export function getLlmClient(): OpenAI | null {
  if (!hasLlmKey()) return null;
  return new OpenAI({
    apiKey: process.env.CUSTOM_API_KEY,
    baseURL: llmBaseUrl(),
  });
}
