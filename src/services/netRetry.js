// One replay of a request that never reached the server.
//
// Chrome reports "TypeError: Failed to fetch" (ERR_CONNECTION_CLOSED in the
// network panel) when it sends a request down a kept-alive connection the
// server has already closed -- Cloudflare idles them out, and the first request
// after Explore sits untouched for a while lands on the dead socket. Chrome
// replays that itself for GET and never for POST, and every IGDB query is a
// POST. One replay opens a fresh connection.
//
// Only a request that never left the client is replayed. A response from the
// server, whatever its status, is a real answer and is handed back; a
// non-network error is somebody else's bug; an abort is the caller's decision.

const isNetworkError = (e) =>
    e instanceof TypeError || (e?.name === 'TypeError');

/**
 * @template T
 * @param {() => Promise<T>} send
 * @param {{ delayMs?: number }} [opts]
 * @returns {Promise<T>}
 */
export const withNetworkRetry = async (send, { delayMs = 300 } = {}) => {
    try {
        return await send();
    } catch (e) {
        if (!isNetworkError(e) || e?.name === 'AbortError') throw e;
        if (delayMs) await new Promise(r => setTimeout(r, delayMs));
        return send();
    }
};
