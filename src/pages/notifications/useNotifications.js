import { useEffect, useState } from 'react';
import { getNotifications, unreadCount, NOTIF_EVENT } from '../../services/notifications';
import { refreshLibraryUpdates } from '../../services/discover';

/* One background check per app session, shared by every caller. It keeps
   refreshLibraryUpdates' own six-hour cadence, so this only asks IGDB when the
   Explore page would have. Before, the feed advanced only when Explore was
   opened, so a badge would have sat on stale news. */
let sessionCheck = null;
const checkOnce = () => {
  if (!sessionCheck) {
    sessionCheck = new Promise(r => setTimeout(r, 4000))
      .then(() => refreshLibraryUpdates())
      .then(() => window.dispatchEvent(new Event(NOTIF_EVENT)))
      .catch(() => { /* offline or IGDB down: the stored feed still shows */ });
  }
  return sessionCheck;
};

/** The notification list and its unread count, kept current. */
export default function useNotifications({ check = true } = {}) {
  const [list, setList] = useState(getNotifications);

  useEffect(() => {
    const reload = () => setList(getNotifications());
    const events = ['moctale_lib_update', 'moctale_sync_update', NOTIF_EVENT];
    events.forEach(e => window.addEventListener(e, reload));
    if (check) checkOnce();
    return () => events.forEach(e => window.removeEventListener(e, reload));
  }, [check]);

  return { list, unread: unreadCount(list) };
}
