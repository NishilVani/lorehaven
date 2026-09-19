/* The Steam half of the linked accounts in Profile. Everything it draws lives
 * in LinkedAccounts; this says which service it is and how to reach it. */
import LinkedAccounts from './LinkedAccounts';
import { steamAccounts, steamUnlinkAccount, startSteamSignIn } from '../../services/steamAuth';

export default function SteamAccount({ user, otherLinks = 0, onCountChange }) {
  return (
    <LinkedAccounts
      user={user}
      service="Steam"
      idKey="steamid"
      loadAccounts={steamAccounts}
      unlinkAccount={steamUnlinkAccount}
      startLink={() => startSteamSignIn({ from: '/profile', intent: 'link' })}
      otherLinks={otherLinks}
      onCountChange={onCountChange}
    />
  );
}
