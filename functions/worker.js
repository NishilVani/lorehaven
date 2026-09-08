/* Cloudflare Worker entry point. The whole proxy is proxy.js, which is written
 * against the standard Request/Response pair, so there is nothing to adapt.
 *
 * Why here rather than Cloud Functions: Firebase Functions needs the Blaze plan,
 * which needs a billing account. The Workers free plan needs neither, and its
 * 100,000 requests a day is far more than this app will ask for.
 *
 * Deploy:
 *   npm i -D wrangler
 *   npx wrangler secret put IGDB_CLIENT_ID
 *   npx wrangler secret put IGDB_CLIENT_SECRET
 *   npx wrangler deploy
 *
 * The secrets live in Cloudflare and are never readable back, which is the whole
 * point: this is the only place the IGDB credential exists.
 */
import { handle } from './proxy.js';

export default {
  /* ctx is passed through for the edge cache: cache.put has to be handed to
     waitUntil or it is cancelled the moment the response is returned. */
  fetch: (request, env, ctx) => handle(request, env, ctx),
};
