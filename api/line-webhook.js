import { waitUntil } from '@vercel/functions';
import { createLineHandler } from '../lib/line-webhook.js';

// Web Request preserves the exact bytes required for LINE signature verification.
export default { fetch: createLineHandler({ waitUntil }) };
