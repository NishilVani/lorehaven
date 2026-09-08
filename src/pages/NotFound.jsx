import { useNavigate, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import EmptyPlate from '../components/ui/EmptyPlate';

/* The catch-all. Without a `path="*"` an unmatched URL matched no route at all,
   so the shell painted and <main> held nothing: no heading, no message, no way
   on. The address is printed because a typo is the likeliest cause and seeing
   it is what lets someone spot the typo. */
export default function NotFound() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <div className="min-h-screen bg-black text-white pb-16 animate-in fade-in duration-500">
      <div className="content-container py-4">
        <PageHeader
          className="mb-4"
          titleClassName="text-[28px] lg:text-[36px] leading-none"
          title="Page Not Found"
          meta={[pathname]}
        />
        <EmptyPlate
          icon={Compass}
          title="Nothing lives at this address"
          body="The link may be old, or the address may have a typo in it."
          action={
            <button
              onClick={() => navigate('/')}
              className="lh-label mt-2 px-4 h-9 border border-white/20 text-white/60 hover:bg-white hover:text-black hover:border-white focus:bg-white focus:text-black focus-visible:outline-none transition-colors cursor-pointer"
            >
              Back to Explore
            </button>
          }
        />
      </div>
    </div>
  );
}
