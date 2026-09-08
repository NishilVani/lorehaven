// src/igdb.js
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import {
    GAMES_CACHE_TTL, readGamesCache, writeGamesCache, partitionByCache, mergeIntoCache,
    markAbsent, absentFrom,
    TTL, withCache,
} from './igdbCache.js';

/* The module below exports its own `fetch` (the rate limiter), which shadows the
   global one inside this file -- so the real implementation is captured here
   first. globalThis, not window: identical in a browser, and it lets Node import
   this module for the unit tests. */
const nativeFetch = globalThis.fetch;

// APIcalypse has no escape syntax — strip quotes/backslashes so user input
// can't terminate the quoted literal and syntax-error the whole query.
const q = (s) => String(s ?? '').replace(/["\\]/g, ' ').trim();
/* Where /api and /wdqs live.
 *
 * Empty in development: the dev server proxies both to a local copy of the same
 * worker (vite.config.js), so development exercises the production path.
 *
 * Every built target needs the absolute origin, because the proxy is a
 * Cloudflare Worker on its own hostname rather than a route on the site: a
 * static host cannot proxy, and the app is served from one. Set
 * VITE_PROXY_ORIGIN at build time, to https://<name>.<subdomain>.workers.dev.
 * An unset value is left to fail loudly rather than falling back to calling
 * IGDB with a credential, which is the thing this indirection exists to stop.
 *
 * The requests are CORS-simple (POST with text/plain or form-encoded bodies),
 * so no preflight is involved; the worker answers OPTIONS anyway. */
const PROXY_ORIGIN = (import.meta.env || {}).VITE_PROXY_ORIGIN || '';

/* IGDB allows four requests a second per client id, and since the proxy landed
 * every client and every tab shares one. replayOrThrow retries a 429 once after
 * a second, which recovers a collision but prevents none, and a page that mounts
 * several fetchers fires them all at once:
 *
 *   IGDB query failed (/api/games): Error: IGDB 429
 *       at getGamesForUpdates -> refreshLibraryUpdates
 *
 * So requests are spaced instead. Each one claims the next free 250ms slot and
 * waits for it; an idle app claims a slot in the past and waits for nothing, so
 * this costs a single request exactly zero. Only a burst is slowed, and it is
 * slowed to the rate IGDB will actually serve rather than to the rate at which
 * it starts refusing.
 *
 * A queue with a concurrency cap was the other shape. This one is eight lines
 * and has no bookkeeping to get wrong; if throughput ever matters more than
 * simplicity, that is the upgrade.
 *
 * 275ms rather than the 250 that four-per-second implies. Five starts spaced by
 * g span 4g, so g must be at least 250 for four-per-second to hold exactly --
 * and measured gaps land within about 15ms either side of the target, so 250
 * would put five starts inside a second often enough to matter. 275 leaves
 * 100ms of headroom and costs a burst of eight requests 0.2s.
 * ponytail: fixed spacing, per tab. The real fix is the same limit inside
 * functions/proxy.js, where it would be shared across clients instead of each
 * client policing only itself. */
const IGDB_MIN_GAP_MS = 275;
let nextSlot = 0;

const rateLimit = async () => {
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + IGDB_MIN_GAP_MS;
    if (at > now) await new Promise(r => setTimeout(r, at - now));
};

const fetch = async (url, options) => {
    /* Images are not IGDB API calls and are not rate limited: they go to the
       image CDN, which has no such budget. */
    if (!url.startsWith('/igdb-img')) await rateLimit();
    if (window.__TAURI_INTERNALS__) {
        /* Images are plain <img> loads and need no proxy; they are the one
           upstream a browser is allowed to reach directly. */
        const finalUrl = url.startsWith('/igdb-img')
            ? 'https://images.igdb.com' + url.substring(9)
            : PROXY_ORIGIN + url;
        return replayOrThrow(url, options, await tauriFetch(finalUrl, options), (o) => tauriFetch(finalUrl, o));
    }
    /* The browser needs the origin too, and for the same reason the comment on
       PROXY_ORIGIN gives: a static host cannot proxy. Empty in development, so
       the relative path still lands on the Vite middleware. */
    const finalUrl = PROXY_ORIGIN + url;
    return replayOrThrow(url, options, await nativeFetch(finalUrl, options), (o) => nativeFetch(finalUrl, o));
};

/* A 4xx/5xx from IGDB or Twitch used to be parsed and, when the body was not
   an array, fall through every fetcher's `Array.isArray(data) ? … : []` as an
   ordinary empty result. Throw here, where all of them converge: every fetcher
   wraps its fetch in a try whose catch announces the failure, and the nine
   behind a page plate rethrow it. A stale token is dropped so the next call
   re-authenticates instead of failing the same way. */
const replayOrThrow = async (url, options, res, again) => {
    if (!res || res.ok || !url.startsWith('/api')) {
        if (res && !res.ok && url.startsWith('/auth')) throw new Error(`IGDB ${res.status}`);
        return res;
    }
    /* One replay on a rate limit, for every fetcher at once, before anything is
       announced: announcing first and retrying second raised the error banner for
       a failure the app then repaired. A 401 is no longer handled here. The token
       belongs to functions/proxy.js, which drops and re-mints it server-side, so
       a 401 reaching a client is a real failure rather than a stale token. */
    if (!options?.__replayed && res.status === 429) {
        await new Promise(r => setTimeout(r, 1000));
        const second = await again({ ...options, __replayed: true });
        if (second.ok) return second;
        res = second;
    }
    throw new Error(`IGDB ${res.status}`);
};

/* The Twitch client-credentials exchange used to happen here, which meant every
   client held the IGDB client secret: it was read out of a world-readable
   Firestore document into localStorage and posted to Twitch by the browser or
   the Tauri shell. A shipped binary cannot keep a secret, so the exchange moved
   to functions/proxy.js, which holds the credential, caches the token and never
   returns either. Nothing here authenticates any more. */

export const searchGames = async (query) => {

    try {
        const response = await fetch('/api/games', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            // Use IGDB native search for fuzzy matching (handles special chars, missing colons, hyphens etc)
            body: `search "${q(query)}"; fields name, game_type, cover.image_id, cover.width, cover.height, summary, first_release_date, involved_companies.company.name, involved_companies.developer, involved_companies.publisher, platforms.id, platforms.name, platforms.abbreviation, platforms.platform_logo.image_id; limit 15;`
        });

        const data = await response.json();
        return Array.isArray(data) ? data.filter(f => f.id !== undefined) : [];
    } catch (error) {
        console.error("Search error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
};

export const searchFranchises = async (query) => {

    try {
        const response = await fetch('/api/franchises', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields name, games.name, games.cover.image_id; where name ~ *"${q(query)}"*; limit 12;`
        });
        const data = await response.json();
        
        // IGDB sometimes returns syntax errors as an array of error objects, e.g. [{ title: "Syntax Error" }]
        // This causes the UI to render a card with no name and "Unknown" label. 
        // We ensure we only return items that have an actual 'id'.
        return Array.isArray(data) ? data.filter(f => f.id !== undefined) : [];
    } catch (error) {
        console.error("Search franchises error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
};

/** Paged franchise browse for the Discover feed — no query, stable id order. */
export const getFranchises = withCache('getFranchises', TTL.DAY, async (limit = 18, offset = 0) => {

    try {
        const response = await fetch('/api/franchises', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields name, games.name, games.cover.image_id; where games != null; sort id asc; limit ${limit}; offset ${offset};`
        });
        const data = await response.json();
        return Array.isArray(data) ? data.filter(f => f.id !== undefined) : [];
    } catch (error) {
        console.error("Browse franchises error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        throw error;
    }
});

export const searchCompanies = async (query) => {
    if (!query) return [];

    try {
        const response = await fetch('/api/companies', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields name, logo.image_id, developed.name, published.name, country, start_date; where name ~ *"${q(query)}"*; limit 12;`
        });
        const data = await response.json();
        return Array.isArray(data) ? data.filter(c => c.id !== undefined) : [];
    } catch (error) {
        console.error("Search companies error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
};

export const getCompanyLogosByIds = withCache('getCompanyLogosByIds', TTL.MONTH, async (ids) => {
    if (!ids || ids.length === 0) return [];

    try {
        const response = await fetch('/api/companies', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields id, logo.image_id; where id = (${ids.join(',')}); limit 50;`
        });
        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error('Fetch company logos error:', error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
});

export const searchPlatforms = async (query) => {
    if (!query) return [];

    try {
        const response = await fetch('/api/platforms', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields name, abbreviation, platform_logo.image_id; where name ~ *"${q(query)}"* | abbreviation ~ *"${q(query)}"*; limit 10;`
        });
        const data = await response.json();
        return Array.isArray(data) ? data.filter(f => f.id !== undefined) : [];
    } catch (error) {
        console.error("Search platforms error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
};

export const getPlatforms = withCache('getPlatforms', TTL.MONTH, async (limit = 50, offset = 0) => {

    try {
        const response = await fetch('/api/platforms', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields name, abbreviation, platform_logo.image_id; limit ${limit}; offset ${offset}; sort name asc;`
        });
        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error("Get platforms error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
});

export const getExternalGameSources = withCache('getExternalGameSources', TTL.MONTH, async (limit = 50, offset = 0) => {

    try {
        const response = await fetch('/api/external_game_sources', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields name; limit ${limit}; offset ${offset}; sort name asc;`
        });
        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error("Get external game sources error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
});

export const searchExternalGameSources = async (query) => {
    if (!query) return [];

    try {
        const response = await fetch('/api/external_game_sources', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields name; where name ~ *"${q(query)}"*i; limit 15;`
        });
        const data = await response.json();
        return Array.isArray(data) ? data.filter(f => f.id !== undefined) : [];
    } catch (error) {
        console.error("Search external game sources error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
};

export const getGameById = withCache('gameById.v2', TTL.WEEK, async (id) => {

    try {
        const response = await fetch('/api/games', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields name, game_type, cover.image_id, cover.width, cover.height, artworks.image_id, artworks.width, artworks.height, artworks.alpha_channel, artworks.artwork_type, screenshots.image_id, screenshots.width, screenshots.height, videos.name, videos.video_id, summary, genres.name, themes.name, game_modes.name, player_perspectives.name, platforms.id, platforms.name, platforms.abbreviation, platforms.platform_logo.image_id, age_ratings.rating, age_ratings.category, game_engines.name, first_release_date, total_rating, total_rating_count, aggregated_rating, aggregated_rating_count, hypes, follows, involved_companies.company.name, involved_companies.developer, involved_companies.publisher, franchise, franchises, collection, collections, external_games.category, external_games.external_game_source, external_games.uid, external_games.url; where id = ${id};`
        });

        const data = await response.json();


        // If IGDB throws a syntax error, it usually returns an object with a 'message'
        if (!Array.isArray(data) && data.message) {
            console.error("IGDB Error:", data.message);
            apiFailure('request', String(data.message), 'request');
            throw new Error(`IGDB ${response.status}`);
        }
        if (!response.ok) {
            apiFailure('request', `IGDB ${response.status}`, 'request');
            throw new Error(`IGDB ${response.status}`);
        }

        if (data.length > 0) {
            try {
                const ttbResponse = await fetch('/api/game_time_to_beats', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'text/plain'
                    },
                    body: `fields hastily, normally, completely; where game_id = ${id}; limit 1;`
                });
                const ttbData = await ttbResponse.json();
                if (Array.isArray(ttbData) && ttbData.length > 0) {
                    data[0].game_time_to_beat = ttbData[0];
                }
            } catch (ttbError) {
                console.error("Fetch game_time_to_beats error:", ttbError);
                apiFailure('/api/game_time_to_beats', String(ttbError?.message || ttbError), 'request');
            }
            return data;
        }
        return null;
    } catch (error) {
        console.error("Fetch game error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        /* Rethrow rather than returning null: /game/:id cannot tell an unknown id
           from a failed lookup otherwise, and it told the user the game does not
           exist. GameDetail is the only caller and catches this. */
        throw error;
    }
});

/**
 * Fetch full metadata for a set of ids straight from IGDB (no cache).
 * Extracted so both the blocking fill and the background refresh can reuse it.
 */
/**
 * @returns {Promise<{games: object[], complete: boolean}>}
 *   `complete` means every chunk's request came back as a list — so an id that is
 *   absent from `games` is genuinely absent from IGDB, and the caller may record
 *   that. It is false when anything went wrong (a throw, or IGDB answering with
 *   an error object instead of an array), where absence proves nothing.
 *
 *   This used to return a bare array and the two cases were indistinguishable,
 *   which is why nothing could safely be remembered about an id that came back
 *   empty. Failing to tell them apart in the other direction would be worse: one
 *   offline moment would tombstone the whole library.
 */
const _fetchGamesByIds = async (ids) => {
    if (!ids || ids.length === 0) return { games: [], complete: true };
    let complete = true;
    try {
        const chunkSize = 500;
        const chunks = [];
        for (let i = 0; i < ids.length; i += chunkSize) {
            chunks.push(ids.slice(i, i + chunkSize));
        }

        let allGames = [];

        for (const chunk of chunks) {
            const response = await fetch('/api/games', {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain'
                },
                body: `fields name, game_type, cover.image_id, cover.width, cover.height, screenshots.image_id, artworks.image_id, first_release_date, involved_companies.company.name, involved_companies.developer, involved_companies.publisher, total_rating, rating, follows, hypes, platforms.id, platforms.name, platforms.abbreviation, platforms.platform_logo.image_id, franchises.name, collections.name; where id = (${chunk.join(',')}); limit 500;`
            });
            const data = await response.json();
            if (Array.isArray(data)) {
                
                try {
                    const ttbResponse = await fetch('/api/game_time_to_beats', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'text/plain'
                        },
                        body: `fields game_id, hastily, normally, completely; where game_id = (${chunk.join(',')}); limit 500;`
                    });
                    const ttbData = await ttbResponse.json();
                    
                    if (Array.isArray(ttbData)) {
                        data.forEach(g => {
                            const ttb = ttbData.find(t => {
                                let tId = t.game_id !== undefined ? t.game_id : t.game;
                                if (Array.isArray(tId)) tId = tId[0];
                                return tId === g.id;
                            });
                            if (ttb) g.game_time_to_beat = ttb;
                        });
                    }
                } catch (ttbError) {
                    console.error("Fetch multiple game_time_to_beats error:", ttbError);
                    apiFailure('/api/game_time_to_beats', String(ttbError?.message || ttbError), 'request');
                }

                allGames.push(...data);
            } else {
                /* IGDB signals failure with an object carrying `message`, not a
                   list. Nothing can be concluded about this chunk's ids. */
                complete = false;
            }
        }
        return { games: allGames, complete };
    } catch (error) {
        console.error("Fetch multiple games error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return { games: [], complete: false };
    }
};

/**
 * Metadata for many games by id — cached in localStorage (stale-while-revalidate).
 * Cached games return instantly with no network; only never-seen ids are fetched
 * before returning. Stale (past-TTL) games are served immediately and refreshed
 * in the background so the next load is fresh. Pass { force: true } to bypass.
 */
export const getGamesByIds = async (ids, { force = false } = {}) => {
    if (!ids || ids.length === 0) return [];


    const cache = readGamesCache();
    const { cachedData, missing, stale } = force
        ? { cachedData: [], missing: ids, stale: [] }
        : partitionByCache(ids, cache, Date.now(), GAMES_CACHE_TTL);

    /* Write back what the fetch taught us: the games it found, AND the ids it
       proved are not there. Recording only the hits is what made an unknown id
       cost a round trip on every call forever. */
    const remember = (base, asked, result) => {
        const now = Date.now();
        const next = mergeIntoCache(base, result.games, now);
        if (result.complete) markAbsent(next, absentFrom(asked, result.games), now);
        if (result.games.length > 0 || result.complete) writeGamesCache(next);
    };

    // Blocking: games we've never cached must be fetched before we can return them.
    let fetched = [];
    if (missing.length > 0) {
        const result = await _fetchGamesByIds(missing);
        fetched = result.games;
        remember(cache, missing, result);
    }

    // Non-blocking: refresh stale entries so the next visit is fresh. Fire-and-forget.
    if (stale.length > 0 && !force) {
        _fetchGamesByIds(stale)
            .then(result => remember(readGamesCache(), stale, result))
            .catch(() => { /* background refresh is best-effort */ });
    }

    return [...cachedData, ...fetched];
};

// ─────────────────────────────────────────────────────────────────────────────
// Discovery — taste profile, recommendations, library-update diffing, radar.
// Used by the Explore page (src/pages/discover/Discover.jsx) via services/discover.js.
// ─────────────────────────────────────────────────────────────────────────────

/* Every fetcher used to swallow a failure into the same value an empty result
   returns, so a broken index rendered as an ordinary empty shelf on fourteen
   routes. Announce it on the event ApiErrorBanner already listens to; the
   return values are unchanged, so no caller sees a rejection. */
const apiFailure = (endpoint, message, kind = 'request') => {
    window.dispatchEvent(new CustomEvent('moctale_api_error', {
        detail: { message, endpoint, kind },
    }));
};

/** IGDB reports failure as { message: "..." } instead of an array. */
const isErrorRow = (x) => x != null && typeof x === 'object' && !Array.isArray(x)
    && (typeof x.message === 'string' || (typeof x.status === 'number' && x.status >= 400 && typeof x.title === 'string'));
/* IGDB reports failure as { message } or, on 4xx, as [{ title, status, cause }]. */
export const igdbErrorMessage = (data) => {
    const row = Array.isArray(data) ? (data.length && data.every(isErrorRow) ? data[0] : null) : (isErrorRow(data) ? data : null);
    return row ? (row.message || `${row.title}${row.cause ? ': ' + row.cause : ''}`) : null;
};

/**
 * Normalise a list response to an array, and recover from a stale token.
 *
 * igdbAuth() only fetches a token when one is ABSENT, so an EXPIRED token would sit
 * in localStorage forever and every request would keep returning 401 "Authorization
 * Failure". Clearing it here means the next call re-authenticates instead of failing
 * permanently. Returning [] keeps callers doing .map() safe.
 */
export const asRows = (data, endpoint = '/api/games') => {
    const msg = igdbErrorMessage(data);
    if (msg) {
        console.error(`IGDB Error (${endpoint}):`, msg);
        const isAuth = /auth/i.test(msg);
        // Returning [] alone is indistinguishable from "no results", so a broken API
        // renders as an ordinary empty shelf. Announce it so the UI can say so and
        // offer a retry (WCAG 3.3.1 Error Identification).
        window.dispatchEvent(new CustomEvent('moctale_api_error', {
            detail: { message: msg, endpoint, kind: isAuth ? 'auth' : 'request' },
        }));
        return [];
    }
    return Array.isArray(data) ? data : [];
};

const igdbGames = async (body, endpoint = '/api/games') => {
    try {
        const r = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body,
        });
        const data = await r.json();
        return asRows(data, endpoint);
    } catch (e) {
        console.error(`IGDB query failed (${endpoint}):`, e);
        apiFailure('request', String(e?.message || e), 'request');
        return [];
    }
};

/**
 * Library games with their genres/themes/franchises AND their fully-expanded
 * `similar_games` — everything the taste profile + hybrid seeds need, in one
 * call. Chunked by 500.
 */
/* Namespaced .v2 because the cache key is `ns:JSON.stringify(args)` — the args
   are the ids, so adding a field to the query does NOT change the key and a
   week-old entry would keep answering without the cover it now asks for. */
export const getGamesProfile = withCache('getGamesProfile.v2', TTL.WEEK, async (ids) => {
    ids = (ids || []).map(Number).filter(Number.isFinite);
    if (ids.length === 0) return [];
    /* cover.image_id is here for the callers that display the game, not just
       score it. A library entry is not guaranteed to carry a cover — several
       add-paths store `cover_id: null` when their source list had none — and
       this is the only place that can supply one without a second request. */
    const fields = `fields name, cover.image_id, parent_game, genres.id, genres.name, themes.id, franchises.id, collections, game_modes.id, ` +
        `involved_companies.company.id, involved_companies.developer, involved_companies.publisher`;
    let out = [];
    for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        try {
            out = out.concat(await igdbGames(`${fields}; where id = (${chunk.join(',')}); limit 500;`));
        } catch (error) {
            // Other chunks may still succeed; callers retain snapshots for
            // games absent from this partial response.
            console.error('[igdb] Failed fetching update chunk', chunk, error);
        }
    }
    return out;
});

/**
 * Card-ready recommendation pool: highly-rated games matching any of the given
 * genre/theme ids. Over-fetches so the caller can filter owned client-side.
 */
/* releasedAfter / releasedBefore are unix seconds and narrow the pool to an era.
   The caller works them out, because the era boundaries belong to discover.js
   and importing them here would close a cycle. */
export const getGamesForDiscovery = withCache('getGamesForDiscovery', TTL.SIXH, async ({ themeIds = [], companyIds = [], franchiseIds = [], limit = 80, offset = 0, sortBy = 'total_rating', releasedAfter = null, releasedBefore = null } = {}) => {
    const clauses = [];
    if (themeIds.length) clauses.push(`themes = (${themeIds.join(',')})`);
    // Developer/publisher — narrow, meaningful ("more from this studio"). Game modes
    // are too broad to gate the query on, so they're scoring-only in discover.js.
    if (companyIds.length) clauses.push(`involved_companies.company = (${companyIds.join(',')})`);
    if (franchiseIds.length) clauses.push(`franchises = (${franchiseIds.join(',')})`);
    if (clauses.length === 0) return [];
    // Main games / remakes / remasters only — keeps DLC and deluxe editions out of the pool
    // (editions are game_type 0 on IGDB but carry version_parent)
    let where = `(${clauses.join(' | ')}) & cover != null & total_rating_count > 5 & total_rating >= 70 ` +
        `& (game_type = 0 | game_type = 8 | game_type = 9 | game_type = null) & version_parent = null`;
    if (releasedAfter) where += ` & first_release_date >= ${Math.floor(releasedAfter)}`;
    if (releasedBefore) where += ` & first_release_date < ${Math.floor(releasedBefore)}`;
    return igdbGames(
        `fields name, game_type, parent_game, cover.image_id, artworks.image_id, artworks.alpha_channel, artworks.artwork_type, summary, first_release_date, total_rating, ` +
        `genres.id, genres.name, themes.id, franchises.id, game_modes.id, ` +
        `involved_companies.company.id, involved_companies.developer, involved_companies.publisher; ` +
        `where ${where}; sort ${sortBy === 'popularity' ? 'total_rating_count' : 'total_rating'} desc; limit ${limit}; offset ${offset};`
    );
});

/**
 * Genuinely-recent announcements: unreleased/upcoming or TBA, hyped, and sorted
 * by when the IGDB entry was created — so long-limbo reveals don't dominate.
 */
export const getRecentlyAnnounced = withCache('getRecentlyAnnounced', TTL.SIXH, async ({ limit = 40, offset = 0 } = {}) => {
  const now = Math.floor(Date.now() / 1000);
  const rows = await igdbGames(
    `fields name, cover.image_id, created_at, first_release_date, genres.name, hypes; ` +
    `where (first_release_date = null | first_release_date >= ${now}) & hypes > 2 & cover != null; sort created_at desc; limit ${limit}; offset ${offset};`
  );
  if (!Array.isArray(rows)) return [];

  // Games announced on the same calendar date are sorted by hype descending
  const toDay = (sec) => (sec ? new Date(sec * 1000).toISOString().slice(0, 10) : '');
  return [...rows].sort((a, b) => {
    const dayA = toDay(a.created_at);
    const dayB = toDay(b.created_at);
    if (dayA !== dayB) return dayB.localeCompare(dayA);
    const hypeDiff = (b.hypes || 0) - (a.hypes || 0);
    if (hypeDiff !== 0) return hypeDiff;
    return (b.created_at || 0) - (a.created_at || 0);
  });
});

/** Full hero payload for one game — artwork + summary the card grids don't fetch. */
export const getGameHero = withCache('getGameHero', TTL.WEEK, async (id) => {
  const rows = await igdbGames(
    `fields name, summary, cover.image_id, artworks.image_id, artworks.alpha_channel, artworks.artwork_type, first_release_date, ` +
    `genres.name, total_rating; where id = ${Number(id)}; limit 1;`
  );
  return rows[0] || null;
});

/* Artwork and screenshots for the wallpapers page.
 *
 * That page had its own copy of the credential flow -- it read igdb_client_id
 * and igdb_client_secret out of localStorage, did the Twitch exchange itself,
 * sent Client-ID and Bearer headers, and rewrote its own URLs to api.igdb.com
 * for the Tauri shell. It was the one caller that never went through this
 * service, so the proxy migration missed it, and it broke twice over: no
 * credentials to read in a browser, and in the desktop shell
 *
 *   Failed to fetch wallpapers: url not allowed on the configured scope:
 *   https://api.igdb.com/v4/games
 *
 * because the http scope now allows the proxy and the image CDN and nothing
 * else. Going through here fixes both, and picks up the rate limiting, the
 * cache and the error reporting the page was doing without.
 *
 * includeSimilar asks for similar_games as well, which is what the first pass
 * over the library needs to find more candidates; the second pass over those
 * candidates does not, and requires that a game actually has artwork.
 * ponytail: limit 500, so a library past that is truncated. It was before too.
 */
export const getGamesForWallpapers = withCache('getGamesForWallpapers', TTL.WEEK, async (ids, includeSimilar = false) => {
    const list = (ids || []).map(Number).filter(Number.isFinite);
    if (list.length === 0) return [];
    const fields = 'fields name, artworks.image_id, artworks.width, artworks.height, '
        + 'screenshots.image_id, screenshots.width, screenshots.height'
        + (includeSimilar ? ', similar_games' : '');
    const where = includeSimilar
        ? `where id = (${list.join(',')});`
        : `where id = (${list.join(',')}) & (artworks != null | screenshots != null);`;
    return igdbGames(`${fields}; ${where} limit ${includeSimilar ? 500 : 100};`);
});

/**
 * Snapshot fields for the library-update diff: the arrays we count (videos,
 * screenshots, artworks) plus the scalars we compare (release date, rating,
 * updated_at). Chunked by 500.
 */
export const getGamesForUpdates = async (ids) => {
    ids = (ids || []).map(Number).filter(Number.isFinite);
    if (ids.length === 0) return [];
    const fields = `fields name, cover.image_id, updated_at, first_release_date, total_rating, ` +
        `videos.id, screenshots.id, artworks.id, game_type`;
    let out = [];
    for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        out = out.concat(await igdbGames(`${fields}; where id = (${chunk.join(',')}); limit 500;`));
    }
    return out;
};

/**
 * Fetches franchise metadata (id + name) for an array of franchise IDs.
 * Resolves franchise IDs returned on game.franchise / game.franchises.
 * POST /api/franchises  →  https://api.igdb.com/v4/franchises
 */
export const getFranchisesByIds = withCache('getFranchisesByIds', TTL.WEEK, async (ids) => {
    ids = (ids || []).map(Number).filter(Number.isFinite);
    if (ids.length === 0) return [];


    try {
        const response = await fetch('/api/franchises', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields id, name; where id = (${ids.join(',')}); limit 20;`
        });
        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error('Fetch franchises error:', error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
});

/**
 * Fetches franchise metadata including nested game covers to get a poster.
 * Used by Library to display rich franchise cards.
 */
export const getFranchiseMetadataByIds = withCache('getFranchiseMetadataByIds', TTL.WEEK, async (ids) => {
    ids = (ids || []).map(Number).filter(Number.isFinite);
    if (ids.length === 0) return [];


    try {
        const response = await fetch('/api/franchises', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields id, name, games.name, games.cover.image_id; where id = (${ids.join(',')}); limit 50;`
        });
        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error('Fetch franchise metadata error:', error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
});
/**
 * Franchises that share at least one game with the given franchise
 * (IGDB has no parent/child relations for franchises, so shared games
 * are the closest "related" signal). Used by FranchisePage.
 */
export const getRelatedFranchises = withCache('getRelatedFranchises', TTL.WEEK, async (franchiseId, gameIds) => {
    if (!franchiseId || !gameIds || gameIds.length === 0) return [];

    try {
        const response = await fetch('/api/franchises', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields id, name, games.cover.image_id; where games = (${gameIds.slice(0, 100).join(',')}) & id != ${franchiseId}; limit 12;`
        });
        const data = await response.json();
        return Array.isArray(data) ? data.filter(f => f.id !== undefined) : [];
    } catch (error) {
        console.error('Fetch related franchises error:', error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
});

/**
 * Fetches all games belonging to a franchise ID.
 * Step 1: POST /api/franchises to get the games[] ID array.
 * Step 2: feed those IDs into getGamesByIds().
 * Used by FranchisePage.
 */
export const getGamesByFranchiseId = withCache('getGamesByFranchiseId', TTL.WEEK, async (franchiseId) => {
    if (!franchiseId) return { franchiseName: '', games: [] };


    try {
        // Step 1 — get franchise name + game IDs
        const franchiseRes = await fetch('/api/franchises', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields id, name, games; where id = ${franchiseId}; limit 1;`
        });
        const franchiseData = await franchiseRes.json();
        if (!Array.isArray(franchiseData) || franchiseData.length === 0) return { franchiseName: '', games: [] };

        const franchise = franchiseData[0];
        const gameIds = franchise.games || [];
        if (gameIds.length === 0) return { franchiseName: franchise.name || '', games: [] };

        // Step 2 — get full game objects using existing getGamesByIds
        const games = await getGamesByIds(gameIds);
        return { franchiseName: franchise.name || '', games };
    } catch (error) {
        console.error('Fetch franchise games error:', error);
        apiFailure('request', String(error?.message || error), 'request');
        throw error;
    }
});

export const getTrendingGames = withCache('getTrendingGames', TTL.SIXH, async ({ limit = 24, offset = 0 } = {}) => {

    // Last 6 months
    const sixMonthsAgo = Math.floor((Date.now() - (180 * 24 * 60 * 60 * 1000)) / 1000);

    try {
        const response = await fetch('/api/games', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields name, cover.image_id, cover.width, cover.height, artworks.image_id, artworks.alpha_channel, artworks.artwork_type, screenshots.image_id, first_release_date, total_rating_count, total_rating, summary, genres.name, involved_companies.company.name; sort total_rating_count desc; where first_release_date > ${sixMonthsAgo} & total_rating_count > 5 & cover != null; limit ${limit}; offset ${offset};`
        });
        const data = await response.json();
        return asRows(data);
    } catch (error) {
        console.error("Fetch trending error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
});

export const getGenres = withCache('getGenres', TTL.MONTH, async () => {

    try {
        const response = await fetch('/api/genres', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields name; limit 50; sort name asc;`
        });
        const data = await response.json();
        return asRows(data);
    } catch (error) {
        console.error("Fetch genres error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
});

/* Themes and modes, listed the same way genres are. IGDB holds ~20 of each and
   they change about never, so a month of cache is generous and one request per
   taxonomy is the whole cost of the Browse hub. Companies and engines have no
   equivalent here on purpose: there are tens of thousands of them, so they stay
   reachable from a game page rather than from an index nobody could read. */
export const getThemes = withCache('getThemes', TTL.MONTH, async () => {

    try {
        const response = await fetch('/api/themes', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields name; limit 50; sort name asc;`
        });
        return asRows(await response.json());
    } catch (error) {
        console.error("Fetch themes error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
});

export const getGameModes = withCache('getGameModes', TTL.MONTH, async () => {

    try {
        const response = await fetch('/api/game_modes', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields name; limit 50; sort name asc;`
        });
        return asRows(await response.json());
    } catch (error) {
        console.error("Fetch game modes error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
});

export const getGamesByGenre = withCache('getGamesByGenre', TTL.WEEK, async (genreId) => {

    try {
        const response = await fetch('/api/games', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields name, game_type, cover.image_id, cover.width, cover.height, artworks.image_id, screenshots.image_id, first_release_date, total_rating_count, total_rating, summary, genres.name, involved_companies.company.name, platforms.name, platforms.abbreviation; where genres = (${genreId}) & first_release_date != null & cover != null; sort total_rating_count desc; limit 100;`
        });
        const data = await response.json();
        return asRows(data);
    } catch (error) {
        console.error("Fetch genre games error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
});

export const getCollectionsByIds = withCache('getCollectionsByIds', TTL.WEEK, async (ids) => {
    ids = (ids || []).map(Number).filter(Number.isFinite);
    if (ids.length === 0) return [];

    try {
        const response = await fetch('/api/collections', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields id, name, type.name, games.name, games.game_type, games.cover.image_id, games.screenshots.image_id, games.artworks.image_id, games.follows, games.hypes, games.total_rating, games.rating; where id = (${ids.join(',')}); limit 50;`
        });
        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error("Get collections error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        throw error;
    }
});

export const searchIgdbCollections = async (query, limit = 12, offset = 0, typeId = null) => {

    try {
        let bodyQuery = '';
        if (query) {
            const filterPart = typeId ? ` & type = ${typeId}` : '';
            bodyQuery = `fields id, name, type.name, games.name, games.game_type, games.cover.image_id, games.screenshots.image_id, games.artworks.image_id, games.follows, games.hypes, games.total_rating, games.rating; where name ~ *"${q(query)}"*${filterPart}; sort name asc; limit ${limit}; offset ${offset};`;
        } else {
            const wherePart = typeId ? `where games != null & type = ${typeId};` : 'where games != null;';
            bodyQuery = `fields id, name, type.name, games.name, games.game_type, games.cover.image_id, games.screenshots.image_id, games.artworks.image_id, games.follows, games.hypes, games.total_rating, games.rating; ${wherePart} sort id asc; limit ${limit}; offset ${offset};`;
        }

        const response = await fetch('/api/collections', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: bodyQuery
        });
        const data = await response.json();
        return Array.isArray(data) ? data.filter(f => f.id !== undefined) : [];
    } catch (error) {
        console.error("Search collections error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        throw error;
    }
};

export const getCollectionTypes = withCache('getCollectionTypes', TTL.MONTH, async () => {

    try {
        const response = await fetch('/api/collection_types', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: 'fields id, name; limit 50;'
        });
        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error("Get collection types error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
});

export const getCollectionMembershipsByCollectionId = withCache('getCollectionMembershipsByCollectionId', TTL.WEEK, async (collectionId) => {
    if (!collectionId) return [];

    try {
        const response = await fetch('/api/collection_memberships', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields game.id, game.name, game.game_type, game.cover.image_id, game.first_release_date, game.platforms.id, game.platforms.name, game.platforms.abbreviation, game.platforms.platform_logo.image_id, type.name; where collection = ${collectionId}; limit 500;`
        });
        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error("Get collection memberships error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        throw error;
    }
});

export const getCollectionRelations = withCache('getCollectionRelations', TTL.WEEK, async (collectionId) => {
    if (!collectionId) return [];

    try {
        const response = await fetch('/api/collection_relations', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields parent_collection.id, parent_collection.name, parent_collection.type.name, child_collection.id, child_collection.name, child_collection.type.name, type.name; where parent_collection = ${collectionId} | child_collection = ${collectionId}; limit 100;`
        });
        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error("Get collection relations error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
});

export const getGameCollectionMemberships = withCache('getGameCollectionMemberships', TTL.WEEK, async (gameId) => {
    if (!gameId) return [];

    try {
        const response = await fetch('/api/collection_memberships', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields collection.id, collection.name, collection.type.name, type.name; where game = ${gameId}; limit 100;`
        });
        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error("Get game collection memberships error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
});


export const getEvents = withCache('getEvents', TTL.DAY, async (limit = 24, offset = 0, query = '', tab = 'events') => {

    try {
        const now = Math.floor(Date.now() / 1000);
        let conditions = [];

        // 1. Time & classification conditions based on tab
        if (tab === 'upcoming') {
            // Include live events: started within the last 4h, or end_time still ahead
            conditions.push(`(start_time > ${now - 14400} | end_time > ${now})`);
        } else if (tab === 'awards') {
            conditions.push(`start_time <= ${now}`);
            conditions.push(`(name ~ *"award"* | name ~ *"awards"* | name ~ *"vga"* | name ~ *"g-phoria"* | name ~ *"golden joystick"*)`);
        } else {
            // tab === 'events' (past events)
            conditions.push(`start_time <= ${now}`);
        }

        // 2. Search query condition
        if (query) {
            conditions.push(`name ~ *"${q(query)}"*`);
        }

        // 3. Sorting order based on tab
        const sortOrder = tab === 'upcoming' ? 'asc' : 'desc';

        const whereClause = conditions.length > 0 ? `where ${conditions.join(' & ')};` : '';
        /* `games` unexpanded — an array of ids, not objects. It costs nothing on
           the wire and it is the only fact that distinguishes one row of this
           index from another: a Sony showcase with 34 titles and a streamer's
           roundup with two rendered identically before this, as a name and a
           date. The ids also let the list say how many of them are already on
           your shelves without a second request. */
        const bodyQuery = `fields name, description, start_time, end_time, live_stream_url, event_logo.image_id, games; limit ${limit}; offset ${offset}; ${whereClause} sort start_time ${sortOrder};`;

        const response = await fetch('/api/events', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: bodyQuery
        });
        const data = await response.json();
        return Array.isArray(data) ? data.filter(e => e.id !== undefined) : [];
    } catch (error) {
        console.error("Get events error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        throw error;
    }
});

export const getEventById = withCache('getEventById', TTL.WEEK, async (id) => {

    try {
        const response = await fetch('/api/events', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields name, description, start_time, end_time, live_stream_url, event_logo.image_id, games.name, games.cover.image_id, games.first_release_date, games.total_rating, games.involved_companies.company.name; where id = ${id};`
        });
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
            return data[0];
        }
        return null;
    } catch (error) {
        console.error("Get event by id error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        throw error;
    }
});

export const getEventsByGameId = withCache('getEventsByGameId', TTL.WEEK, async (gameId) => {
    if (!gameId) return [];

    try {
        const response = await fetch('/api/events', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields name, start_time, event_logo.image_id; where games = (${gameId}); sort start_time desc;`
        });
        const data = await response.json();
        return Array.isArray(data) ? data.filter(e => e.id !== undefined) : [];
    } catch (error) {
        console.error("Get events by game id error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
});

export const getGenreById = withCache('getGenreById', TTL.MONTH, async (id) => {
    try {
        const response = await fetch('/api/genres', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields name; where id = ${id};`
        });
        const data = await response.json();
        return Array.isArray(data) && data.length > 0 ? data[0] : null;
    } catch (error) {
        console.error("Get genre error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return null;
    }
});

export const getCompanyById = withCache('getCompanyById', TTL.MONTH, async (id) => {
    try {
        const response = await fetch('/api/companies', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields name; where id = ${id};`
        });
        const data = await response.json();
        return Array.isArray(data) && data.length > 0 ? data[0] : null;
    } catch (error) {
        console.error("Get company error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return null;
    }
});

export const getThemeById = withCache('getThemeById', TTL.MONTH, async (id) => {
    try {
        const response = await fetch('/api/themes', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields name; where id = ${id};`
        });
        const data = await response.json();
        return Array.isArray(data) && data.length > 0 ? data[0] : null;
    } catch (error) {
        console.error("Get theme error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return null;
    }
});

export const getEngineById = withCache('getEngineById', TTL.MONTH, async (id) => {
    try {
        const response = await fetch('/api/game_engines', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields name; where id = ${id};`
        });
        const data = await response.json();
        return Array.isArray(data) && data.length > 0 ? data[0] : null;
    } catch (error) {
        console.error("Get engine error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return null;
    }
});

export const getGameModeById = withCache('getGameModeById', TTL.MONTH, async (id) => {
    try {
        const response = await fetch('/api/game_modes', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields name; where id = ${id};`
        });
        const data = await response.json();
        return Array.isArray(data) && data.length > 0 ? data[0] : null;
    } catch (error) {
        console.error("Get game mode error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return null;
    }
});

export const getPlatformById = withCache('getPlatformById', TTL.MONTH, async (id) => {
    try {
        const response = await fetch('/api/platforms', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields name, abbreviation; where id = ${id};`
        });
        const data = await response.json();
        return Array.isArray(data) && data.length > 0 ? data[0] : null;
    } catch (error) {
        console.error("Get platform error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return null;
    }
});

export const getGamesByCompanyId = withCache('getGamesByCompanyId', TTL.WEEK, async (companyId) => {
    try {
        const response = await fetch('/api/games', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields name, game_type, cover.image_id, cover.width, cover.height, artworks.image_id, screenshots.image_id, first_release_date, total_rating_count, total_rating, summary, genres.name, involved_companies.company.name, platforms.name, platforms.abbreviation; where involved_companies.company = ${companyId} & first_release_date != null & cover != null; sort total_rating_count desc; limit 100;`
        });
        const data = await response.json();
        return asRows(data);
    } catch (error) {
        console.error("Fetch company games error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
});

export const getGamesByThemeId = withCache('getGamesByThemeId', TTL.WEEK, async (themeId) => {
    try {
        const response = await fetch('/api/games', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields name, game_type, cover.image_id, cover.width, cover.height, artworks.image_id, screenshots.image_id, first_release_date, total_rating_count, total_rating, summary, genres.name, involved_companies.company.name, platforms.name, platforms.abbreviation; where themes = (${themeId}) & first_release_date != null & cover != null; sort total_rating_count desc; limit 100;`
        });
        const data = await response.json();
        return asRows(data);
    } catch (error) {
        console.error("Fetch theme games error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
});

export const getGamesByPlatformId = withCache('getGamesByPlatformId', TTL.WEEK, async (platformId) => {
    try {
        const response = await fetch('/api/games', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: `fields name, game_type, cover.image_id, cover.width, cover.height, artworks.image_id, screenshots.image_id, first_release_date, total_rating_count, total_rating, summary, genres.name, involved_companies.company.name, platforms.name, platforms.abbreviation; where platforms = (${platformId}) & first_release_date != null & cover != null; sort total_rating_count desc; limit 100;`
        });
        const data = await response.json();
        return asRows(data);
    } catch (error) {
        console.error("Fetch platform games error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
});

export const getGamesByCategory = withCache('getGamesByCategory', TTL.DAY, async ({
    categoryType,
    categoryId,
    limit = 24,
    offset = 0,
    sortBy = 'Newest',
    gameTypeTab = 'All',
    platformFilter = null,
    highlyRatedOnly = false,
    /* The release span the density chart selects. Server-side, like every
       other narrowing here — a client-side year filter would only ever filter
       the page already in hand. */
    releasedFrom = null,
    releasedBefore = null
}) => {

    const conditions = [categoryCondition(categoryType, categoryId), 'first_release_date != null', 'cover != null'];

    if (gameTypeTab === 'Game') {
        conditions.push('(game_type = 0 | game_type = null)');
    } else if (gameTypeTab === 'Others') {
        conditions.push('(game_type != 0 & game_type != null)');
    }

    if (platformFilter !== null) {
        if (Array.isArray(platformFilter)) {
            if (platformFilter.length > 0) {
                conditions.push(`platforms = (${platformFilter.join(',')})`);
            }
        } else {
            conditions.push(`platforms = (${platformFilter})`);
        }
    }

    if (highlyRatedOnly) {
        conditions.push('(total_rating >= 80 | rating >= 80)');
    }

    if (releasedFrom !== null) conditions.push(`first_release_date >= ${Date.UTC(releasedFrom, 0, 1) / 1000}`);
    if (releasedBefore !== null) conditions.push(`first_release_date < ${Date.UTC(releasedBefore, 0, 1) / 1000}`);

    const whereClause = `where ${conditions.join(' & ')}`;

    let sortClause = '';
    if (sortBy === 'Newest') {
        sortClause = 'sort first_release_date desc;';
    } else if (sortBy === 'Top Rated') {
        sortClause = 'sort total_rating desc;';
    } else if (sortBy === 'Popularity') {
        sortClause = 'sort total_rating_count desc;';
    } else if (sortBy === 'A-Z') {
        sortClause = 'sort name asc;';
    }

    const bodyQuery = `fields name, game_type, cover.image_id, cover.width, cover.height, artworks.image_id, artworks.alpha_channel, artworks.artwork_type, screenshots.image_id, first_release_date, total_rating_count, total_rating, summary, genres.name, involved_companies.company.name, platforms.name, platforms.abbreviation; ${whereClause}; ${sortClause} limit ${limit}; offset ${offset};`;

    try {
        const response = await fetch('/api/games', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: bodyQuery
        });
        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error("Fetch category games error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
});

/* The taxonomy's own where-clause. It was written out twice, in
   getGamesByCategory and getGamesCountByCategory, which is exactly the shape
   that let CategoryPage's status colours drift from everyone else's. The
   histogram below would have been a third copy. */
export const categoryCondition = (categoryType, categoryId) => {
    if (categoryType === 'genre') return `genres = (${categoryId})`;
    if (categoryType === 'company') return `involved_companies.company = ${categoryId}`;
    if (categoryType === 'theme') return `themes = (${categoryId})`;
    if (categoryType === 'platform') return `platforms = (${categoryId})`;
    if (categoryType === 'engine') return `game_engines = (${categoryId})`;
    if (categoryType === 'mode') return `game_modes = (${categoryId})`;
    return '';
};

/**
 * Many counts in ONE request, through IGDB's multiquery endpoint, which takes
 * ten named queries at a time.
 *
 * Returns a name -> count map with null for anything that did not come back, so
 * a failed batch still cannot masquerade as a row of confident zeroes.
 */
const countMany = async (specs) => {
    if (!specs.length) return {};
    const out = {};
    specs.forEach(sp => { out[sp.name] = null; });

    for (let i = 0; i < specs.length; i += 10) {
        const batch = specs.slice(i, i + 10);
        const body = batch
            .map(sp => `query games/count "${sp.name}" { where ${sp.conditions.join(' & ')}; };`)
            .join(' ');
        try {
            const response = await fetch('/api/multiquery', {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body,
            });
            if (!response.ok) continue;
            const rows = await response.json();
            if (!Array.isArray(rows)) continue;
            rows.forEach(r => {
                if (r && typeof r.name === 'string' && typeof r.count === 'number') out[r.name] = r.count;
            });
        } catch (error) {
            console.error('Multiquery count error:', error);
            apiFailure('/api/multiquery', String(error?.message || error), 'request');
        }
    }
    return out;
};


/** Everything before this is one bucket; after it, five years at a time. */
const HISTOGRAM_EPOCH = 1980;
const HISTOGRAM_STEP = 5;
const unixOfYear = (y) => Date.UTC(y, 0, 1) / 1000;

/**
 * True release counts per time bucket for a taxonomy — the genre's own shape,
 * not a sample of it.
 *
 * IGDB has no GROUP BY, so a distribution costs one /count per bucket. That is
 * the whole reason this is bucketed at five years and cached for a week rather
 * than drawn per-year on every visit: eleven cheap counts once per taxonomy,
 * free afterwards. Sampling the first few hundred games instead would have been
 * one request and a lie — the page states only what it has actually counted.
 *
 * Deliberately blind to the page's filters. This describes the taxonomy, so it
 * must not move when someone narrows the grid beneath it.
 */
export const getCategoryReleaseHistogram = withCache('getCategoryReleaseHistogram', TTL.WEEK, async ({ categoryType, categoryId }) => {
    const cond = categoryCondition(categoryType, categoryId);
    if (!cond) return [];

    /* The buckets must PARTITION the taxonomy, or the chart quietly disagrees
       with the count above it: capping the last bucket at this year left every
       announced-but-unreleased title outside all of them, and the bars summed
       to 82,724 under a header reading 83,042. First bucket is open at the
       bottom, last is open at the top. */
    const thisYear = new Date().getUTCFullYear();
    const spans = [{ from: null, to: HISTOGRAM_EPOCH, label: `< ${HISTOGRAM_EPOCH}` }];
    for (let y = HISTOGRAM_EPOCH; y <= thisYear; y += HISTOGRAM_STEP) {
        const last = y + HISTOGRAM_STEP > thisYear;
        spans.push({
            from: y,
            to: last ? null : y + HISTOGRAM_STEP,
            label: last ? `${String(y).slice(2)}+` : `${String(y).slice(2)}–${String(y + HISTOGRAM_STEP - 1).slice(2)}`,
        });
    }

    /* Two requests for eleven buckets, not eleven requests. Everything the old
       serial loop existed to survive — the gaps, the retry, the 429s that came
       back with an empty grid — was a consequence of the request COUNT, so the
       fix was to stop making eleven of them. Measured cold on Adventure: 13.5s
       to draw the chart before, about a second after. */
    const specs = spans.map((sp, i) => {
        const c = [cond, 'first_release_date != null', 'cover != null'];
        if (sp.from !== null) c.push(`first_release_date >= ${unixOfYear(sp.from)}`);
        if (sp.to !== null) c.push(`first_release_date < ${unixOfYear(sp.to)}`);
        return { name: `b${i}`, conditions: c };
    });
    const counts = await countMany(specs);
    /* Null, not a list of nulls, when nothing came back. withCache refuses to
       store null but happily stores a non-empty array — so a multiquery aborted
       by a navigation would otherwise cache "no counts for this taxonomy" for a
       whole week. */
    if (spans.every((_, i) => counts[`b${i}`] === null)) return null;
    return spans.map((sp, i) => ({ ...sp, count: counts[`b${i}`] }));
});

/**
 * The release dates of the caller's own shelved games that belong to this
 * taxonomy — the coverage layer drawn inside the histogram bars.
 *
 * One request, because a library entry stores first_release_date but not its
 * genres, so membership has to be asked. Counting only the games already loaded
 * into the grid would have been free and wrong: it would report coverage of the
 * first two pages as coverage of the genre.
 */
export const getCategoryLibraryDates = async ({ categoryType, categoryId, ids }) => {
    const cond = categoryCondition(categoryType, categoryId);
    if (!cond || !ids?.length) return [];
    try {
        const response = await fetch('/api/games', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: `fields id, first_release_date; where ${cond} & id = (${ids.slice(0, 500).join(',')}) & first_release_date != null; limit 500;`,
        });
        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error('Fetch category library dates error:', error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
};

/**
 * How many games sit under each term of a taxonomy — the whole genre list, or
 * theme list, counted in one pass.
 *
 * An index of 23 names is a list of links; an index of 23 names with real sizes
 * tells you the shape of the catalogue before you have opened anything. Cheap
 * now that counts batch: 23 genres is three multiquery requests, cached for a
 * week. A term whose count did not come back stays null and renders without a
 * number rather than with a zero it did not earn.
 */
export const getTaxonomyCounts = withCache('getTaxonomyCounts', TTL.WEEK, async ({ type, ids }) => {
    if (!ids?.length) return {};
    const specs = ids.map(id => ({
        name: `t${id}`,
        conditions: [categoryCondition(type, id), 'first_release_date != null', 'cover != null'],
    }));
    const counts = await countMany(specs);
    // As above: an all-null map is a failure, and must not be cached as an answer.
    if (ids.every(id => counts[`t${id}`] === null)) return null;
    const out = {};
    ids.forEach(id => { out[id] = counts[`t${id}`]; });
    return out;
});

export const getGamesCountByCategory = withCache('getGamesCountByCategory', TTL.DAY, async ({
    categoryType,
    categoryId,
    gameTypeTab = 'All',
    platformFilter = null,
    highlyRatedOnly = false,
    /* The release span the density chart selects. Server-side, like every
       other narrowing here — a client-side year filter would only ever filter
       the page already in hand. */
    releasedFrom = null,
    releasedBefore = null
}) => {

    const conditions = [categoryCondition(categoryType, categoryId), 'first_release_date != null', 'cover != null'];

    if (gameTypeTab === 'Game') {
        conditions.push('(game_type = 0 | game_type = null)');
    } else if (gameTypeTab === 'Others') {
        conditions.push('(game_type != 0 & game_type != null)');
    }

    if (platformFilter !== null) {
        if (Array.isArray(platformFilter)) {
            if (platformFilter.length > 0) {
                conditions.push(`platforms = (${platformFilter.join(',')})`);
            }
        } else {
            conditions.push(`platforms = (${platformFilter})`);
        }
    }

    if (highlyRatedOnly) {
        conditions.push('(total_rating >= 80 | rating >= 80)');
    }

    if (releasedFrom !== null) conditions.push(`first_release_date >= ${Date.UTC(releasedFrom, 0, 1) / 1000}`);
    if (releasedBefore !== null) conditions.push(`first_release_date < ${Date.UTC(releasedBefore, 0, 1) / 1000}`);

    const whereClause = `where ${conditions.join(' & ')}`;
    const bodyQuery = `${whereClause};`;

    try {
        const response = await fetch('/api/games/count', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: bodyQuery
        });
        const data = await response.json();
        return data && typeof data.count === 'number' ? data.count : 0;
    } catch (error) {
        console.error("Fetch games count error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        throw error;
    }
});

export const getCategoryPlatforms = withCache('getCategoryPlatforms', TTL.WEEK, async ({ categoryType, categoryId }) => {

    let categoryCondition = '';
    if (categoryType === 'genre') {
        categoryCondition = `genres = (${categoryId})`;
    } else if (categoryType === 'company') {
        categoryCondition = `involved_companies.company = ${categoryId}`;
    } else if (categoryType === 'theme') {
        categoryCondition = `themes = (${categoryId})`;
    } else if (categoryType === 'platform') {
        categoryCondition = `platforms = (${categoryId})`;
    } else if (categoryType === 'engine') {
        categoryCondition = `game_engines = (${categoryId})`;
    } else if (categoryType === 'mode') {
        categoryCondition = `game_modes = (${categoryId})`;
    }

    const bodyQuery = `fields platforms.id, platforms.name, platforms.abbreviation; where ${categoryCondition} & first_release_date != null & cover != null; limit 500;`;

    try {
        const response = await fetch('/api/games', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: bodyQuery
        });
        const data = await response.json();
        
        const uniquePlats = {};
        if (Array.isArray(data)) {
            data.forEach(g => {
                g.platforms?.forEach(p => {
                    if (p.abbreviation || p.name) {
                        uniquePlats[p.id] = {
                            id: p.id,
                            name: p.name,
                            abbreviation: p.abbreviation
                        };
                    }
                });
            });
        }
        return Object.values(uniquePlats);
    } catch (error) {
        console.error("Fetch category platforms error:", error);
        apiFailure('request', String(error?.message || error), 'request');
        return [];
    }
});

/**
 * Schedule Tab — fetch release dates from IGDB.
 * Returns deduplicated game entries grouped by date.
 *
 * @param {Object} opts
 * @param {'released'|'upcoming'} opts.timeFilter
 * @param {number|null}  opts.year       — filter to specific year
 * @param {number|null}  opts.month      — filter to specific month (1-12)
 * @param {'all'|'base'|'dlc'} opts.gameType — 'base' = game_type 0, 'dlc' = everything else
 * @param {number}       opts.limit
 * @param {number}       opts.offset
 */
export const getReleaseDates = withCache('getReleaseDates', TTL.SIXH, async ({
    timeFilter = 'upcoming',
    year = null,
    month = null,
    gameType = 'all',
    limit = 50,
    offset = 0
} = {}) => {

    try {
        const now = Math.floor(Date.now() / 1000);
        const conditions = [];

        // Year + month range — when set, these override the time filter
        // to avoid contradictory conditions (e.g. "Released" + future month)
        if (year !== null) {
            const m0 = month !== null ? month - 1 : 0;   // JS month 0-indexed
            // UTC on both sides: IGDB dates are UTC instants and Schedule labels them
            // in UTC. Local midnight opened the January window 8h late in Los Angeles,
            // dropping rows dated at UTC midnight on the 1st out of their own month.
            const startUnix = Date.UTC(year, m0, 1) / 1000;
            const endUnix = (month !== null ? Date.UTC(year, m0 + 1, 1) : Date.UTC(year + 1, 0, 1)) / 1000;
            conditions.push(`date >= ${startUnix}`);
            conditions.push(`date < ${endUnix}`);
            
            // If in upcoming tab, still enforce date > now so we don't show past games of the selected year
            if (timeFilter === 'upcoming') {
                conditions.push(`date > ${now}`);
            }
        } else {
            // Only apply time filter when no explicit year/month is selected
            if (timeFilter === 'upcoming') {
                conditions.push(`date > ${now}`);
            } else {
                conditions.push(`date <= ${now}`);
            }
        }

        // Game type
        if (gameType === 'base') {
            conditions.push('(game.game_type = 0 | game.game_type = null)');
        } else if (gameType === 'dlc') {
            conditions.push('game.game_type != 0');
            conditions.push('game.game_type != null');
        }

        // Require cover art for visual display
        conditions.push('game.cover != null');

        const whereClause = conditions.length > 0 ? `where ${conditions.join(' & ')};` : '';
        const sortOrder = timeFilter === 'upcoming' ? 'asc' : 'desc';

        const bodyQuery = `fields date, human, game.name, game.cover.image_id, game.hypes, game.follows, game.game_type, game.total_rating, platform.name, platform.abbreviation, region; ${whereClause} sort date ${sortOrder}; limit ${limit}; offset ${offset};`;

        const response = await fetch('/api/release_dates', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: bodyQuery
        });
        const data = await response.json();
        if (!Array.isArray(data)) return { results: [], rawCount: 0 };

        const rawCount = data.length;

        // Deduplicate by game ID — multiple platforms produce duplicates.
        // Keep the entry with the most hypes, preserve platform list.
        const gameMap = new Map();
        for (const entry of data) {
            if (!entry.game || !entry.game.name) continue;
            const gid = entry.game.id || entry.game.name;
            const existing = gameMap.get(gid);
            if (!existing) {
                // Collect platform into array
                entry._platforms = entry.platform ? [entry.platform] : [];
                gameMap.set(gid, entry);
            } else {
                // Merge platform
                if (entry.platform) {
                    const already = existing._platforms.some(p => p.id === entry.platform.id);
                    if (!already) existing._platforms.push(entry.platform);
                }
            }
        }
        return { results: Array.from(gameMap.values()), rawCount };
    } catch (error) {
        console.error('getReleaseDates error:', error);
        apiFailure('request', String(error?.message || error), 'request');
        throw error;
    }
});

/**
 * Schedule Tab — fetch "announced" games (no release date yet).
 * Returns games with first_release_date = null & hypes > 0, sorted by hypes.
 */
export const getAnnouncedGames = withCache('getAnnouncedGames', TTL.SIXH, async ({
    gameType = 'all',
    limit = 50,
    offset = 0
} = {}) => {

    try {
        const conditions = ['first_release_date = null', 'hypes > 0', 'cover != null'];

        if (gameType === 'base') {
            conditions.push('(game_type = 0 | game_type = null)');
        } else if (gameType === 'dlc') {
            conditions.push('game_type != 0');
            conditions.push('game_type != null');
        }

        const whereClause = `where ${conditions.join(' & ')}`;
        const bodyQuery = `fields name, hypes, follows, cover.image_id, game_type, platforms.name, platforms.abbreviation; ${whereClause}; sort hypes desc; limit ${limit}; offset ${offset};`;

        const response = await fetch('/api/games', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: bodyQuery
        });
        let data = await response.json();
        data = Array.isArray(data) ? data.filter(g => g.id !== undefined) : [];

        if (data.length > 0) {
            try {
                const gameIds = data.map(g => g.id);
                const eventsRes = await fetch('/api/events', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'text/plain'
                    },
                    body: `fields games, start_time; where games = (${gameIds.join(',')}); limit 500;`
                });
                const eventsData = await eventsRes.json();
                
                if (Array.isArray(eventsData)) {
                    const earliestEventMap = new Map();
                    for (const evt of eventsData) {
                        if (!evt.games || !evt.start_time) continue;
                        for (const gid of evt.games) {
                            if (!earliestEventMap.has(gid) || evt.start_time < earliestEventMap.get(gid)) {
                                earliestEventMap.set(gid, evt.start_time);
                            }
                        }
                    }
                    for (const game of data) {
                        if (earliestEventMap.has(game.id)) {
                            game._firstEventYear = new Date(earliestEventMap.get(game.id) * 1000).getFullYear().toString();
                        }
                    }
                }
            } catch (err) {
                console.error('Failed to fetch events for announced games:', err);
                apiFailure('/api/events', String(err?.message || err), 'request');
            }
        }
        
        return data;
    } catch (error) {
        console.error('getAnnouncedGames error:', error);
        apiFailure('request', String(error?.message || error), 'request');
        throw error;
    }
});

