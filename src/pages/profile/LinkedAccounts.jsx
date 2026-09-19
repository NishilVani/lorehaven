/* The store accounts in the Profile header: which ones sign in to this
 * LoreHaven account, and the ways to change that.
 *
 * There can be more than one of each. A main Steam account and a family one is
 * an ordinary thing to own, so this is a list, and each row unlinks on its own.
 *
 * Unlinking is only offered while the account can still be reached another way:
 * an email and password, or another linked account of any service. The last way
 * in is never taken away, and the Worker refuses it too -- this is the half that
 * says so before the person clicks.
 *
 * `otherLinks` is how many accounts of OTHER services this LoreHaven account
 * holds. Without it each list would think its own last row was the last way in
 * while a second service still signed the person in perfectly well.
 */
import { useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { toast } from '../../components/ui/toastBus';

export default function LinkedAccounts({
  user, service, idKey, loadAccounts, unlinkAccount, startLink, otherLinks = 0, onCountChange,
}) {
  /* Kept with the account it was read for, so a sign-out or a different account
     shows nothing rather than the last account's answer. */
  const [state, setState] = useState({ uid: null, accounts: [] });
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return undefined;
    let live = true;
    loadAccounts()
      .catch(() => [])
      .then((accounts) => {
        if (!live) return;
        setState({ uid: user.uid, accounts });
        onCountChange?.(accounts.length);
      });
    return () => { live = false; };
    /* loadAccounts is rebuilt every render by its wrapper; the account is what
       decides whether this should run again. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (!user || state.uid !== user.uid) return null;
  const { accounts } = state;
  const shortId = (id) => `${service} account ending ${String(id).slice(-4)}`;
  const hasPassword = (user.providerData || []).some(p => p.providerId === 'password');
  const lastWayIn = accounts.length === 1 && !hasPassword && otherLinks === 0;

  const unlink = async () => {
    const account = confirming;
    setBusy(true);
    try {
      await unlinkAccount(account[idKey]);
      setState((s) => {
        const left = s.accounts.filter(a => a[idKey] !== account[idKey]);
        onCountChange?.(left.length);
        return { ...s, accounts: left };
      });
      setConfirming(null);
      toast(`${account.name || `That ${service} account`} is no longer linked`);
    } catch (err) {
      toast(err?.message || `${service} could not be unlinked`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const linkStyle = 'tap lh-label inline-flex items-center min-h-6 gap-1.5 text-white/70 underline underline-offset-4 decoration-white/30 hover:text-white hover:decoration-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white';

  return (
    <div className="mt-2 text-[13px] text-white/60">
      {accounts.length === 0 ? (
        <button type="button" onClick={startLink} className={linkStyle}>
          Link {service} to This Account
        </button>
      ) : (
        <ul className="list-none p-0 m-0 flex flex-col gap-1" aria-label={`${service} accounts linked to this LoreHaven account`}>
          {accounts.map(account => (
            <li key={account[idKey]} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-white/70">{account.name || shortId(account[idKey])}</span>
              <span className="lh-label text-white/40">Signs in with {service}</span>
              {lastWayIn ? (
                <span className="lh-label text-white/40">Add an email and password to unlink it</span>
              ) : (
                <button type="button" onClick={() => setConfirming(account)} className={linkStyle}>
                  Unlink
                  <span className="sr-only">{account.name || shortId(account[idKey])}</span>
                </button>
              )}
            </li>
          ))}
          <li>
            <button type="button" onClick={startLink} className={linkStyle}>
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              Link Another {service} Account
            </button>
          </li>
        </ul>
      )}

      <ConfirmDialog
        open={!!confirming}
        onClose={() => setConfirming(null)}
        onConfirm={unlink}
        eyebrow={service}
        title={`Unlink this ${service} account?`}
        body={`${confirming?.name || `That ${service} account`} will no longer sign in to LoreHaven. Nothing already imported from it is removed, and you can link it again whenever you like.`}
        confirmLabel={busy ? 'Unlinking' : `Unlink ${service}`}
      />
      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
    </div>
  );
}
