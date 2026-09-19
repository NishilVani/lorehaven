/* The Xbox half of the linked accounts in Profile. The only thing it does that
 * Steam's does not is start the sign-in through the Worker, which is where the
 * client id lives. */
import LinkedAccounts from './LinkedAccounts';
import { xboxAccounts, xboxUnlinkAccount, startXboxSignIn } from '../../services/xboxAuth';
import { toast } from '../../components/ui/toastBus';

export default function XboxAccount({ user, otherLinks = 0, onCountChange }) {
  const startLink = () => {
    startXboxSignIn({ purpose: 'link', from: '/profile' })
      .catch(err => toast(err?.message || 'Xbox sign-in could not be started', 'error'));
  };

  return (
    <LinkedAccounts
      user={user}
      service="Xbox"
      idKey="xuid"
      loadAccounts={xboxAccounts}
      unlinkAccount={xboxUnlinkAccount}
      startLink={startLink}
      otherLinks={otherLinks}
      onCountChange={onCountChange}
    />
  );
}
