/* The Steam accounts in the Profile header: which ones sign in to this
 * LoreHaven account, and the ways to change that.
 *
 * There can be more than one. A main account and a family one is an ordinary
 * thing to own, so this is a list, and each row unlinks on its own.
 *
 * Unlinking is only offered while the account can still be reached another way:
 * an email and password, or another linked account. The last way in is never
 * taken away, and the Worker refuses it too.
 */
import { useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { toast } from '../../components/ui/toastBus';
import { steamAccounts, steamUnlinkAccount, startSteamSignIn } from '../../services/steamAuth';

const shortId = (steamid) => `Steam account ending ${String(steamid).slice(-4)}`;

export default function SteamAccount({ user }) {
  /* Kept with the account it was read for, so a sign-out or a different account
     shows nothing rather than the last account's answer. */
  const [state, setState] = useState({ uid: null, accounts: [] });
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return undefined;
    let live = true;
    steamAccounts()
      .catch(() => [])
      .then((accounts) => { if (live) setState({ uid: user.uid, accounts }); });
    return () => { live = false; };
  }, [user]);

  if (!user || state.uid !== user.uid) return null;
  const { accounts } = state;
  const hasPassword = (user.providerData || []).some(p => p.providerId === 'password');
  const lastWayIn = accounts.length === 1 && !hasPassword;

  const startLink = () => startSteamSignIn({ from: '/profile', intent: 'link' });

  const unlink = async () => {
    const account = confirming;
    setBusy(true);
    try {
      await steamUnlinkAccount(account.steamid);
      setState(s => ({ ...s, accounts: s.accounts.filter(a => a.steamid !== account.steamid) }));
      setConfirming(null);
      toast(`${account.name || 'That Steam account'} is no longer linked`);
    } catch (err) {
      toast(err?.message || 'Steam could not be unlinked', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 text-[13px] text-white/60">
      {accounts.length === 0 ? (
        <button
          type="button"
          onClick={startLink}
          className="tap lh-label inline-flex items-center min-h-6 gap-1.5 text-white/70 underline underline-offset-4 decoration-white/30 hover:text-white hover:decoration-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
        >
          Link Steam to This Account
        </button>
      ) : (
        <ul className="list-none p-0 m-0 flex flex-col gap-1" aria-label="Steam accounts linked to this LoreHaven account">
          {accounts.map(account => (
            <li key={account.steamid} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-white/70">{account.name || shortId(account.steamid)}</span>
              <span className="lh-label text-white/40">Signs in with Steam</span>
              {lastWayIn ? (
                <span className="lh-label text-white/40">Add an email and password to unlink it</span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(account)}
                  className="tap lh-label inline-flex items-center min-h-6 gap-1.5 text-white/70 underline underline-offset-4 decoration-white/30 hover:text-white hover:decoration-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
                >
                  Unlink
                  <span className="sr-only">{account.name || shortId(account.steamid)}</span>
                </button>
              )}
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={startLink}
              className="tap lh-label inline-flex items-center min-h-6 gap-1.5 text-white/70 underline underline-offset-4 decoration-white/30 hover:text-white hover:decoration-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              Link Another Steam Account
            </button>
          </li>
        </ul>
      )}

      <ConfirmDialog
        open={!!confirming}
        onClose={() => setConfirming(null)}
        onConfirm={unlink}
        eyebrow="Steam"
        title="Unlink this Steam account?"
        body={`${confirming?.name || 'That Steam account'} will no longer sign in to LoreHaven. Nothing already imported from it is removed, and you can link it again whenever you like.`}
        confirmLabel={busy ? 'Unlinking' : 'Unlink Steam'}
      />
      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
    </div>
  );
}
