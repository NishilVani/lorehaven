import PageHeader from '../../components/ui/PageHeader';
import './wizard.css';

const STEPS = [
    { num: 1, label: 'Upload' },
    { num: 2, label: 'Schema' },
    { num: 3, label: 'Mapping' },
    { num: 4, label: 'Review' },
];

export default function WizardShell({ step, setStep, isFetchingApi, canGoNext, onNext, onStopFetching, csvData, reviewItems, fileName, children }) {
    // Preserved verbatim from the original footer count — this is the number written to the library.
    const saveCount = reviewItems.filter(i => i.isSelected && !(i.resolutionAction === 'skip' && !i.conflict)).length;

    const nextLabel = {
        2: 'Continue',
        3: 'Fetch IGDB',
        4: saveCount ? `Save ${saveCount} Games` : 'Save',
    }[step];

    // Right-hand metadata for the page header — tells you what you're holding at each step.
    const meta = {
        1: 'Step 01 / 04',
        2: `${csvData.length} Rows${fileName ? ` · ${fileName}` : ''}`,
        3: `${csvData.length} Rows${fileName ? ` · ${fileName}` : ''}`,
        4: isFetchingApi ? 'Fetching' : `${reviewItems.length} Matched`,
    }[step];

    return (
        <div className="min-h-screen bg-black text-white antialiased pt-8 pb-16">
            <div className="content-container">

                <PageHeader
                    className="mb-6 mt-2"
                    title={STEPS[step - 1].label}
                    count={meta}
                />

                {/* Step index + actions — one strip, sticky, always reachable */}
                {/* aria-current is the only thing that tells a screen reader which step
                    you are on — the white fill is not exposed. WCAG 4.1.2. */}
                <div role="group" aria-label="Import steps" className="sticky top-0 z-30 bg-black flex border border-white/15 mb-8">
                    {STEPS.map(s => {
                        const isActive = s.num === step;
                        const isDone = s.num < step;
                        const canJump = isDone && !isFetchingApi;
                        return (
                            <button
                                key={s.num}
                                onClick={() => canJump && setStep(s.num)}
                                aria-current={isActive ? 'step' : undefined}
                                disabled={!canJump}
                                className={`flex items-baseline gap-2 px-2.5 sm:px-4 py-2.5 whitespace-nowrap border-r border-white/10 transition-colors ${canJump ? 'cursor-pointer' : isActive ? 'cursor-default' : 'cursor-not-allowed opacity-30'} ${isActive
                                    ? 'bg-white text-black'
                                    : isDone
                                        ? 'text-white/50 hover:text-white'
                                        : 'text-white/50'
                                    }`}
                            >
                                {/* No opacity here: it multiplied with the button's own
                                    text-white/50 down to 2.45:1. Inherit instead. */}
                                <span className="lh-label">{String(s.num).padStart(2, '0')}</span>
                                <span className="lh-label hidden sm:inline">{s.label}</span>
                            </button>
                        );
                    })}

                    <div className="flex-1 min-w-0" />

                    {step > 1 && (
                        <button
                            onClick={() => setStep(step - 1)}
                            disabled={isFetchingApi}
                            className="lh-label px-3 sm:px-4 py-2.5 whitespace-nowrap border-l border-white/10 text-white/50 hover:text-white disabled:opacity-30 disabled:hover:text-white/50 transition-colors cursor-pointer disabled:cursor-not-allowed"
                        >
                            Back
                        </button>
                    )}

                    {step > 1 && (isFetchingApi ? (
                        <button
                            onClick={onStopFetching}
                            className="lh-label px-3 sm:px-4 py-2.5 whitespace-nowrap border-l border-white/10 text-[var(--destructive)] hover:bg-[var(--destructive-hover)] hover:text-black transition-colors cursor-pointer"
                        >
                            Stop
                        </button>
                    ) : (
                        <button
                            onClick={onNext}
                            disabled={!canGoNext}
                            className="lh-label px-3 sm:px-4 py-2.5 whitespace-nowrap border-l border-white/10 bg-white text-black hover:bg-neutral-200 disabled:opacity-30 disabled:hover:bg-white transition-colors cursor-pointer disabled:cursor-default"
                        >
                            {nextLabel}
                        </button>
                    ))}
                </div>

                <div key={step} className="animate-in fade-in duration-200">
                    {children}
                </div>
            </div>
        </div>
    );
}
