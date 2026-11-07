import { provider } from './provider.js';

// Reuses the existing Cloudflare provider identity; each caller links their own account.
export const requirements = { user: { accounts: { cloudflare: provider } } };
