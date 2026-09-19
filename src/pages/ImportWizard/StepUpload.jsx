import Papa from 'papaparse';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

const SPEC = [
    ['Format', 'CSV — comma separated, first row is the header'],
    ['Required', 'One column holding the game name'],
    ['Optional', 'Status · Priority · Rating · Platform · Completion date · Notes'],
    ['Matching', 'Each name is looked up on IGDB — you confirm every match before anything is saved'],
];

export default function StepUpload({
    isDragging,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFileUpload,
    fileInputRef,
    fileName,
    parseResultsAndProceed
}) {
    return (
        <div className="max-w-3xl">
            {/* Steam first: a library on Steam can be read directly and matched
                by Steam's own ids, which is both less work and more exact than
                exporting a sheet and matching it by name. */}
            <Link
                to="/import/steam"
                className="group flex items-center justify-between gap-4 border border-white/15 px-5 py-4 mb-6 hover:border-white/70 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
            >
                <span className="min-w-0">
                    <span className="block lh-label text-white">Import From Steam</span>
                    <span className="block text-[13px] text-white/60 mt-1">Read your Steam library and wishlist directly, with no spreadsheet.</span>
                </span>
                <ChevronRight className="w-4 h-4 shrink-0 text-white/60 group-hover:text-white transition-colors" aria-hidden="true" />
            </Link>

            {/* Xbox next, and second on purpose: it reads what an account has
                PLAYED, which is the closest thing Microsoft offers to a library,
                and it needs a sign-in every time because nothing is kept. */}
            <Link
                to="/import/xbox"
                className="group flex items-center justify-between gap-4 border border-white/15 px-5 py-4 mb-6 hover:border-white/70 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
            >
                <span className="min-w-0">
                    <span className="block lh-label text-white">Import From Xbox</span>
                    <span className="block text-[13px] text-white/60 mt-1">Read the games your Xbox account has played, matched by their Microsoft Store ids.</span>
                </span>
                <ChevronRight className="w-4 h-4 shrink-0 text-white/60 group-hover:text-white transition-colors" aria-hidden="true" />
            </Link>

            {/* Dropzone — a bordered plate, nothing more */}
            <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                /* Click-anywhere is a mouse convenience only. The keyboard path is the
                   real <label>/<input> pair below — the input is sr-only rather than
                   hidden so it stays in the tab order and activates natively. Clicks
                   from that pair are ignored here or the picker would open twice. */
                onClick={(e) => {
                    if (e.target.closest('label,input')) return;
                    fileInputRef.current?.click();
                }}
                className={`border border-dashed px-6 py-16 text-center cursor-pointer transition-colors ${isDragging ? 'border-white bg-white/[0.03]' : 'border-white/20 hover:border-white/70'
                    }`}
            >
                <div className="lh-display text-xl lg:text-2xl text-white mb-3 break-all">
                    {fileName || 'Drop CSV Here'}
                </div>
                <div className="lh-label text-white/60 mb-8">
                    {fileName ? 'Loaded — drop another to replace' : 'Or click anywhere on this plate to browse'}
                </div>

                <input
                    ref={fileInputRef}
                    id="csv-file-input"
                    type="file"
                    accept=".csv"
                    aria-label="Choose a CSV file to import"
                    onChange={handleFileUpload}
                    className="sr-only"
                />

                {/* A real <label> is the keyboard entry point: focus lands on the
                    sr-only input and Enter/Space opens the picker natively. */}
                <label
                    htmlFor="csv-file-input"
                    className="inline-block lh-label px-5 py-2.5 bg-white text-black cursor-pointer"
                >
                    Browse Files
                </label>
            </div>

            {/* Sample — one line, no ceremony */}
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    fetch('/test.csv').then(res => res.text()).then(csvText => {
                        Papa.parse(csvText, {
                            header: true,
                            skipEmptyLines: true,
                            complete: parseResultsAndProceed
                        });
                    });
                }}
                className="mt-3 w-full lh-label py-2.5 border border-white/20 text-white/50 hover:bg-white hover:text-black hover:border-white transition-colors cursor-pointer"
            >
                Load Sample CSV
            </button>

            {/* What the importer expects — bordered index table */}
            <div className="mt-12">
                <div className="flex items-center gap-3 mb-4">
                    <h2 className="lh-display text-[22px] lg:text-[28px] text-white/80 m-0">Expected Shape</h2>
                    <div className="flex-1 h-px bg-white/15" />
                </div>
                <div className="border border-white/15">
                    {SPEC.map(([k, v]) => (
                        <div key={k} className="flex flex-col sm:flex-row gap-1 sm:gap-4 px-4 py-3 border-t first:border-t-0 border-white/10">
                            <span className="lh-label text-white/60 sm:w-24 shrink-0">{k}</span>
                            <span className="text-[13px] text-white/70">{v}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
