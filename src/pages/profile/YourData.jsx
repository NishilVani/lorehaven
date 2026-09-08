import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Upload, Trash2, ChevronRight } from 'lucide-react';
import useConfirm from '../../hooks/useConfirm';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { toast } from '../../components/ui/toastBus';
import { getLibrary, clearLibrary } from '../../services/db';
import { exportLibraryCsv } from '../../services/exportLibrary';
import { Card } from './parts';

/* Band D — where the library physically lives, and the things you do TO it
 * rather than with it.
 *
 * The two halves are one band because they are the same subject seen twice: the
 * left is the inventory of hardware, stores and subscriptions the library is
 * spread across, and the right is how it gets in, out, or gone. Manage Platforms
 * used to be a row in this list and is now the button under the list it manages,
 * which is the only place it was ever going to be found.
 *
 * All of it lived in the account dropdown, which was the wrong place for two
 * different reasons. Manage Platforms is a whole page with three tabs and a
 * transfer flow, reachable only from a menu; and Clear Library — the one action
 * in the app that takes everything and cannot be undone — sat one row above Log
 * out, close enough to reach by accident and with nothing around it to say what
 * it costs.
 *
 * Here each one gets a line of consequence next to it. The confirm step is
 * unchanged: it still asks you to type CLEAR, because that is the only defence
 * against a mis-click that ends 240 entries.
 */

const nf = new Intl.NumberFormat();

function Action({ icon: Icon, label, detail, onClick, danger, busy }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy || undefined}
      /* Busy is not dimmed. The detail line is the thing that says what is
         happening, and dimming the one line you need to read is the mistake the
         danger row above already documents. The cursor and the dead hover carry
         the state; the copy carries the meaning. */
      className={`w-full flex items-center gap-4 text-left border-b border-white/15 py-4 px-1 last:border-b-0 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white ${
        busy ? 'cursor-progress' : 'cursor-pointer'
      } ${
        danger ? 'text-[var(--destructive)] enabled:hover:bg-[var(--destructive-hover)] enabled:hover:text-black' : 'text-white enabled:hover:bg-white enabled:hover:text-black'
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{label}</span>
        {/* Deliberately not .lh-label: this is a sentence, and the label style is
            an 11px uppercase 0.18em track that turns prose into a barcode.

            Full strength on the danger row. It was dimmed to 60% like the others
            and axe measured the destructive red under 4.5:1 there — but the
            contrast was the smaller half of the mistake. This is the one line on
            the page that has to be read before the click, and it was the only
            one set quieter than its own label. */}
        <span className={`block text-[13px] mt-0.5 ${danger ? '' : 'opacity-60'}`}>{detail}</span>
      </span>
      {!danger && <ChevronRight className="w-4 h-4 shrink-0 opacity-60" aria-hidden="true" />}
    </button>
  );
}

/** One place the library lives, sized against the biggest one. The kind is
 *  printed once per run rather than on every row — a console, a storefront and a
 *  subscription are three different claims and stacking the word next to all
 *  eight of them turns the column into wallpaper. */
function PlaceRows({ rows, peak }) {
  return (
    <ul className="list-none p-0 m-0">
      {rows.map(r => (
        <li key={`${r.kind}-${r.name}`} className="flex items-center gap-3 py-1.5">
          <span className="lh-label text-white/50 w-[104px] shrink-0">{r.first ? r.kind : ''}</span>
          <span className="text-sm text-white w-28 sm:w-32 shrink-0 min-w-0 break-words">{r.name}</span>
          <span className="flex-1 min-w-0 h-1.5 block bg-white/10" aria-hidden="true">
            <span className="block h-full bg-white/80" style={{ width: `${(r.count / peak) * 100}%` }} />
          </span>
          <span className="lh-label text-white/60 tabular-nums min-w-7 text-right shrink-0">{nf.format(r.count)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function YourData({ stats: s }) {
  const navigate = useNavigate();
  const [confirm, confirmProps] = useConfirm();

  const places = [
    ...s.places.hardware.map(r => ({ ...r, kind: 'Hardware' })),
    ...s.places.subscription.map(r => ({ ...r, kind: 'Subscription' })),
    ...s.places.store.map(r => ({ ...r, kind: 'Store' })),
  ].map((r, i, all) => ({ ...r, first: i === 0 || all[i - 1].kind !== r.kind }));
  const placePeak = Math.max(1, ...places.map(r => r.count));

  /* Read on click, not on render. A count captured at mount would put a stale
     number inside a confirmation for an irreversible action. */
  const handleClear = () => {
    const count = getLibrary().length;
    if (count === 0) { toast('Your library is already empty'); return; }
    confirm(
      {
        eyebrow: 'Library',
        title: 'Clear your entire library?',
        body: `This removes all ${nf.format(count)} ${count === 1 ? 'game' : 'games'} and their statuses, ratings and notes from this device. It cannot be undone.`,
        confirmLabel: 'Clear Library',
        /* The only action in the app that takes everything and cannot be
           undone, so it is the only one that asks you to type. */
        confirmPhrase: 'CLEAR',
      },
      () => { clearLibrary(); toast('Library cleared'); },
    );
  };

  /* The export became async when papaparse moved to a dynamic import, and an
     async handler on a button is a double-submit waiting to happen: the first
     click is still awaiting the chunk while the second, third and fourth start
     their own serialisation of the whole library and hand the browser four
     identical downloads. The row reads as busy while it runs, so the state is
     the affordance and not just a lock. */
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const result = await exportLibraryCsv();
      if (result.rows === 0) { toast('Nothing to export yet'); return; }
      toast(result.saved
        ? `Exported ${nf.format(result.rows)} ${result.rows === 1 ? 'entry' : 'entries'}`
        : 'Could not save the file. Check the app has permission to download.');
    } catch {
      /* exportLibraryCsv catches its own save failure, so reaching here means
         the papaparse chunk itself did not load — offline, or a bad deploy. */
      toast('Could not build the file. Check your connection and try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <section aria-labelledby="data-heading" className="mt-12">
      <h2 id="data-heading" className="lh-display text-[22px] lg:text-[28px] text-white m-0 mb-1">Your data</h2>
      <p className="text-sm text-white/60 mt-0 mb-5">Where the library lives, and how it gets in and out</p>

      <div className="grid gap-4 md:grid-cols-2 md:items-start">
        <Card
          headingId="places-heading"
          title="Where your library lives"
          note={s.places.unrecorded > 0
            ? `${nf.format(s.places.unrecorded)} ${s.places.unrecorded === 1 ? 'entry has' : 'entries have'} nothing recorded`
            : null}
        >
          {places.length > 0
            ? <PlaceRows rows={places} peak={placePeak} />
            : (
              <p className="text-sm text-white/60 m-0">
                Nothing recorded yet. Say where a game lives on its page and this fills in.
              </p>
            )}
          <button
            type="button"
            onClick={() => navigate('/platforms')}
            className="tap lh-label mt-5 px-4 py-3 border border-white/20 text-white/60 hover:border-white hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white transition-colors cursor-pointer"
          >
            Manage Platforms
          </button>
        </Card>

        <Card headingId="actions-heading" title="Everything here acts on the whole library">
          <Action
            icon={Upload}
            label="Import a Library"
            detail="Bring games across from a spreadsheet or another tracker"
            onClick={() => navigate('/import')}
          />
          <Action
            icon={Download}
            label="Export as CSV"
            detail={exporting
              ? `Building a file of ${nf.format(s.total)} ${s.total === 1 ? 'entry' : 'entries'}…`
              : 'A copy of every entry, status, verdict, priority and note'}
            busy={exporting}
            onClick={handleExport}
          />
          <Action
            icon={Trash2}
            danger
            label="Clear Library"
            detail="Removes every game, status, rating and note. There is no undo."
            onClick={handleClear}
          />
        </Card>
      </div>

      <ConfirmDialog {...confirmProps} />
    </section>
  );
}
