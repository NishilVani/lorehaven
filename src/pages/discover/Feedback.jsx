import PageHeader from '../../components/ui/PageHeader';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import GameCard from '../../components/games/GameCard';
import EmptyPlate from '../../components/ui/EmptyPlate';
import { ThumbsUp, EyeOff } from 'lucide-react';
import { toast } from '../../components/ui/Toast';
import { getRecFeedbackList, setRecFeedback } from '../../services/db';

/** Manage the Interested / Not Interested signals that tune recommendations. */
/* Module-level on purpose: a component declared inside the page's render is a new
   type every render, which remounts every card and resets its state. */
function FeedbackGrid({ list, icon, title, body, onFeedback }) {
  if (list.length === 0) return <EmptyPlate icon={icon} title={title} body={body} />;
  return (
    <div className="game-grid">
      {list.map(x => (
        <GameCard
          key={x.id}
          game={{ id: x.id, name: x.name || 'Unknown', cover_id: x.cover_id || null }}
          onFeedback={onFeedback}
        />
      ))}
    </div>
  );
}

export default function Feedback() {
  const navigate = useNavigate();
  const [items, setItems] = useState(() => getRecFeedbackList());

  const refreshItems = useCallback(() => {
    setItems(getRecFeedbackList());
  }, []);

  useEffect(() => {
    window.addEventListener('moctale_lib_update', refreshItems);
    window.addEventListener('moctale_sync_update', refreshItems);
    return () => {
      window.removeEventListener('moctale_lib_update', refreshItems);
      window.removeEventListener('moctale_sync_update', refreshItems);
    };
  }, [refreshItems]);

  // onFeedback fires when a card's ⋯ menu toggles/clears a verdict
  const handleFeedback = useCallback((game, verdict) => {
    setRecFeedback(game, verdict);
    refreshItems();
    toast(verdict ? 'Updated' : 'Removed');
  }, [refreshItems]);

  const interested = items.filter(x => x.verdict === 'interested');
  const notInterested = items.filter(x => x.verdict === 'not_interested');

  return (
    <div className="min-h-screen bg-black text-white pb-16 animate-in fade-in duration-500">
      <div className="content-container py-4">
        <PageHeader
          className="mb-3"
          back={{ label: 'Explore', onClick: () => navigate('/'), ariaLabel: 'Go back to Explore' }}
          title="Your Feedback"
        />
        <p className="text-sm text-white/50 max-w-prose mb-8">
          Games you marked shape your recommendations. <span className="text-white/70">Interested</span> games
          pull in more like them; <span className="text-white/70">Not Interested</span> games are hidden from
          all suggestions. Open a card's ⋯ menu to clear a mark.
        </p>

        <section className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="lh-display text-[22px] lg:text-[28px] text-white/80 m-0">Interested</h2>
            <div className="flex-1 h-px bg-white/15" />
            <span className="lh-label text-white/60 tabular-nums">{interested.length}</span>
          </div>
          <FeedbackGrid list={interested} icon={ThumbsUp} title="Nothing marked Interested yet"
            body="Mark a recommendation Interested and it lands here, and more like it start showing up on Explore."
            onFeedback={handleFeedback} />
        </section>

        <section>
          <div className="flex items-center gap-3 mb-4">
            <h2 className="lh-display text-[22px] lg:text-[28px] text-white/80 m-0">Not Interested</h2>
            <div className="flex-1 h-px bg-white/15" />
            <span className="lh-label text-white/60 tabular-nums">{notInterested.length}</span>
          </div>
          <FeedbackGrid list={notInterested} icon={EyeOff} title="Nothing hidden yet"
            body="Games you mark Not Interested are hidden from every suggestion, and you can bring one back from here."
            onFeedback={handleFeedback} />
        </section>
      </div>
    </div>
  );
}
