// Server-side env access. CUSTOM_API_KEY must never be imported into a client component.
export const hasLlmKey = () => Boolean(process.env.CUSTOM_API_KEY?.trim());

export const llmBaseUrl = () =>
  process.env.CUSTOM_API_BASE_URL?.trim() || 'https://riyckji.abc-tunnel.us/v1';

export const llmModel = () => process.env.CUSTOM_API_MODEL?.trim() || 'cx/gpt-5.5';

export const contactEmail = () =>
  process.env.VERIFIER_CONTACT_EMAIL?.trim() || 'demo@example.com';
