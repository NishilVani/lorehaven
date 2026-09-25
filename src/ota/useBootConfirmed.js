import { useEffect } from 'react';
import { OTA_KEYS } from './policy.js';
import { toast } from '../components/ui/toastBus';
import { openExternal } from '../services/openExternal';

/* Where the APK lives. There is no store listing; releases are sideloaded. */
const RELEASES = 'https://github.com/NishilVani/lorehaven/releases/latest';

/**
 * The app side of the OTA boot check (src/ota/bootstrap.js).
 *
 * Mounting is the proof a bundle works, so the marker the bootstrap set before
 * injecting a remote bundle is cleared here. A bundle that never gets this far
 * leaves it set, and the next launch loads the embedded bundle instead.
 *
 * It is also where the one OTA outcome a user must act on is said: the release
 * needs native code this APK does not have. Everything else is silent.
 */
export default function useBootConfirmed() {
  useEffect(() => {
    try { localStorage.removeItem(OTA_KEYS.marker); } catch { /* nothing to clear */ }
    const ota = window.__LH_OTA__;
    if (ota?.reason === 'shell-too-old') {
      toast(`LoreHaven ${ota.version} needs a new app install.`, 'info', {
        label: 'Download',
        onClick: () => openExternal(RELEASES),
      });
    }
  }, []);
}
