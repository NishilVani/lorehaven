const LABELS = { name: 'Game Name', status: 'Status', priority: 'Priority', rating: 'Rating (Feel)', notes: 'Notes', platform: 'Platform(s)', completionDate: 'Completion Date' };

export default function StepSchemaV2({ columnMap, setColumnMap, csvHeaders, csvData = [], nameProblem = null }) {
    const fields = Object.keys(columnMap);
    const mappedCount = fields.filter(f => columnMap[f]).length;

    // First non-empty cell for a column — shows the user what they actually mapped.
    const sampleFor = (header) => {
        if (!header) return null;
        const row = csvData.find(r => r[header] && String(r[header]).trim());
        return row ? String(row[header]).trim() : null;
    };

    const unused = csvHeaders.filter(h => !Object.values(columnMap).includes(h));

    return (
        <div>
            <div className="flex items-center gap-3 mb-4">
                <h2 className="lh-display text-[22px] lg:text-[28px] text-white/80 m-0">Column → Field</h2>
                <div className="flex-1 h-px bg-white/15" />
                <span className="lh-label text-white/60 tabular-nums">{mappedCount} / {fields.length} Mapped</span>
            </div>

            <div className="border border-white/15">
                {fields.map((field) => {
                    const isRequired = field === 'name';
                    const value = columnMap[field] || '';
                    const sample = sampleFor(value);
                    /* An unterminated quote makes papaparse swallow the following lines
                       into one cell, so a line break in a sample is a reliable sign the
                       column did not parse. Three or more commas is a heuristic for the
                       same shape and is worded more softly. */
                    const brokenLine = !!sample && /[\r\n]/.test(sample);
                    const manyCommas = !!sample && !brokenLine && (sample.match(/,/g) || []).length >= 3;

                    return (
                        <div
                            key={field}
                            className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4 px-4 py-3 border-t first:border-t-0 border-white/10"
                        >
                            {/* Field */}
                            <div className="flex items-baseline gap-2 lg:w-52 shrink-0">
                                <span className={`lh-label ${value ? 'text-white' : 'text-white/50'}`}>{LABELS[field]}</span>
                                {isRequired && (
                                    <span className={`lh-label ${value ? 'text-white/50' : 'text-[var(--destructive)]'}`}>Required</span>
                                )}
                                {isRequired && nameProblem && (
                                    <span className="lh-label text-[var(--warning)]" role="alert">{nameProblem}</span>
                                )}
                            </div>

                            {/* Source column */}
                            <select
                                aria-label={`Source column for ${LABELS[field] || field}`}
                                value={value}
                                onChange={(e) => setColumnMap({ ...columnMap, [field]: e.target.value })}
                                className={`h-9 px-3 bg-black border lh-label outline-none transition-colors cursor-pointer w-full lg:w-64 shrink-0 ${isRequired && !value ? 'border-[var(--destructive-border)] text-white' : 'border-white/40 focus:border-white/70 text-white'
                                    }`}
                            >
                                <option value="" className="bg-black">— Unmapped —</option>
                                {csvHeaders.map(header => (
                                    <option key={header} value={header} className="bg-black">{header}</option>
                                ))}
                            </select>

                            {/* Sample value — proof you picked the right column */}
                            <div className="min-w-0 flex-1 flex items-baseline gap-2">
                                {sample ? (
                                    <>
                                        <span className="lh-label text-white/50 shrink-0">e.g.</span>
                                        <span className="text-xs text-white/50 truncate font-mono" title={sample}>{sample}</span>
                                        {(brokenLine || manyCommas) && (
                                            <span className="lh-label text-[var(--warning)] shrink-0">
                                                {brokenLine ? 'Contains a line break: this column did not parse' : 'Holds several comma-separated values: check the column'}
                                            </span>
                                        )}
                                    </>
                                ) : (
                                    <span className="lh-label text-white/50">{value ? 'Column is empty' : 'Not mapped'}</span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Columns the import will ignore — stops silent data loss surprises */}
            {unused.length > 0 && (
                <div className="mt-10">
                    <div className="flex items-center gap-3 mb-4">
                        <h2 className="lh-display text-[22px] lg:text-[28px] text-white/80 m-0">Ignored Columns</h2>
                        <div className="flex-1 h-px bg-white/15" />
                        <span className="lh-label text-white/60 tabular-nums">{unused.length}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {unused.map(h => (
                            <span key={h} className="lh-label px-3 py-2 border border-white/15 text-white/60 max-w-full truncate" title={h}>
                                {h}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
