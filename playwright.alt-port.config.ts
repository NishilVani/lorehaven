/* The main config on port 5174 with its own stubbed dev server, for running
 * the specs while a developer's own dev server holds 5173 (which the main
 * config would reuse, with live IGDB instead of the stub).
 *   npx playwright test -c playwright.alt-port.config.ts ... */
import base from './playwright.config';

export default {
  ...base,
  use: { ...base.use, baseURL: 'http://localhost:5174' },
  webServer: {
    ...base.webServer,
    command: 'npx vite --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: false,
  },
};
