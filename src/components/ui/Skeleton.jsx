import { ArrowLeft } from 'lucide-react';

/* Every skeleton is aria-hidden. They carry no information, and their placeholder
   copy reads as real UI — CollectionDetailSkeleton announced a "Back to Collections"
   link that does not exist. Pages announce their own loading state via useAnnounce. */

export const Skeleton = ({ className = '', ...props }) => (
    <div aria-hidden="true" className={`skeleton-placeholder ${className}`} {...props} />
);

export const GameCardSkeleton = ({ className = '' }) => (
    // Mirrors the GameCard disc box: spine + top band + art + bottom strip
    <div aria-hidden="true" className={`flex w-full border border-white/10 bg-black overflow-hidden ${className}`}>
        <div className="w-4 shrink-0 border-r border-white/10" />
        <div className="flex-1 min-w-0 flex flex-col">
            <div className="h-5 shrink-0 border-b border-white/10 flex items-center px-1.5">
                <Skeleton className="h-2 w-1/2" />
            </div>
            <Skeleton className="w-full aspect-[3/4]" />
            <div className="h-5 shrink-0 border-t border-white/10 flex items-center px-1.5">
                <Skeleton className="h-2 w-1/3" />
            </div>
        </div>
    </div>
);

export const WallpaperCardSkeleton = ({ aspect = 16/9 }) => (
    <div aria-hidden="true" className="flex flex-col p-2 border border-transparent bg-white/[0.01]">
        <div className="mb-2">
            <Skeleton className="w-full" style={{ aspectRatio: aspect }} />
        </div>
        <div className="px-1">
            <Skeleton className="h-3.5 w-3/4 mb-2" />
            <Skeleton className="h-3 w-1/2" />
        </div>
    </div>
);

export const CollectionSkeleton = () => (
    <div aria-hidden="true" className="flex flex-col border border-transparent overflow-hidden bg-white/[0.01]">
        <div className="px-2 pt-2">
            <Skeleton className="w-full aspect-video" />
        </div>
        <div className="p-3">
            <Skeleton className="h-4 w-3/4 mb-2" />
            <Skeleton className="h-3 w-1/2" />
        </div>
    </div>
);

export const HeroSkeleton = () => (
    <div aria-hidden="true" className="relative h-[400px] md:h-[500px] w-full overflow-hidden mb-12 bg-white/[0.01]">
        <div className="absolute inset-0 bg-white/[0.02]"></div>
        <div className="absolute bottom-12 left-8 md:left-12 space-y-4 w-full max-w-2xl">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-12 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-10 w-32 mt-6" />
        </div>
    </div>
);

export const GenreSkeleton = () => (
    <div aria-hidden="true" className="flex gap-3 overflow-hidden mb-8 px-1">
        {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-10 w-24 shrink-0" />
        ))}
    </div>
);

export const CollectionDetailSkeleton = () => (
    <div aria-hidden="true" className="min-h-screen antialiased pt-8 pb-16" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
        <div className="content-container">
            {/* Navigation Breadcrumb */}
            <div className="inline-flex items-center gap-1.5 text-xs text-gray-400 font-bold mb-2 pl-3">
                <ArrowLeft className="w-4 h-4" />
                Back to Collections
            </div>

            {/* Title & Description Header */}
            <div className="mb-8 pl-3 space-y-3">
                <Skeleton className="h-8 w-1/3" />
                <Skeleton className="h-4 w-1/2" />
            </div>

            {/* Two-column layout grid */}
            <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-10">
                {/* Sidebar Area (Left) */}
                <div className="flex flex-col gap-6 pt-3">
                    <div className="p-5 bg-white/[0.01] border border-white/[0.06] flex flex-col gap-4">
                        <div className="border-b border-white/[0.06] pb-3 mb-1">
                            <Skeleton className="h-3 w-1/3" />
                        </div>
                        <div className="flex flex-col gap-3.5">
                            <div className="flex justify-between">
                                <Skeleton className="h-3 w-1/4" />
                                <Skeleton className="h-3 w-1/4" />
                            </div>
                            <div className="flex justify-between">
                                <Skeleton className="h-3 w-1/4" />
                                <Skeleton className="h-3 w-1/4" />
                            </div>
                            <div className="flex justify-between">
                                <Skeleton className="h-3 w-1/4" />
                                <Skeleton className="h-3 w-1/4" />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Main Area (Right) */}
                <div className="min-w-0">
                    <div className="game-grid">
                        {[...Array(12)].map((_, i) => (
                            <GameCardSkeleton key={i} />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    </div>
);

// Mirrors one row of the Import Wizard review index table
export const ReviewCardSkeleton = () => (
    <div aria-hidden="true" className="flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-3 border-t border-white/10">
        <Skeleton className="w-4 h-4 shrink-0" />
        <Skeleton className="w-8 h-2.5 shrink-0 hidden sm:block" />
        <Skeleton className="w-8 h-11 sm:w-9 sm:h-12 shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-2.5 w-1/4" />
        </div>
        <Skeleton className="w-20 h-2.5 shrink-0 hidden sm:block" />
        <Skeleton className="w-12 h-2.5 shrink-0" />
    </div>
);

export const CategoryPageSkeleton = () => (
    <div aria-hidden="true" className="min-h-screen bg-black text-white pb-16 animate-in fade-in duration-500">
        {/* Banner skeleton */}
        <div className="w-full h-[250px] md:h-[350px] overflow-hidden border-b border-white/15 bg-neutral-950 relative">
            <div className="absolute inset-0 bg-neutral-900 animate-pulse" />
        </div>

        <div className="content-container py-6">
            {/* Header skeleton */}
            <header className="mb-8">
                <Skeleton className="h-3 w-12 mb-2 rounded-none bg-white/10" />

                <div className="flex items-baseline justify-between gap-4 flex-wrap">
                    <Skeleton className="h-10 md:h-14 lg:h-16 w-3/4 max-w-md rounded-none bg-white/10" />
                    <Skeleton className="h-3.5 w-24 rounded-none bg-white/10" />
                </div>
            </header>

            <div className="h-px bg-white/15 mb-6" />

            {/* Controls skeleton */}
            <div className="flex flex-col gap-4 mb-8">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="flex border border-white/15">
                        <Skeleton className="h-10 w-16 border-r border-white/15 rounded-none bg-white/10 animate-pulse" />
                        <Skeleton className="h-10 w-16 border-r border-white/15 rounded-none bg-white/10 animate-pulse" />
                        <Skeleton className="h-10 w-16 rounded-none bg-white/10 animate-pulse" />
                    </div>
                    <Skeleton className="h-10 w-36 rounded-none bg-white/10 animate-pulse" />
                    <Skeleton className="h-10 w-32 rounded-none bg-white/10 animate-pulse" />
                    <Skeleton className="h-10 w-28 rounded-none bg-white/10 animate-pulse" />
                    <Skeleton className="h-10 w-32 rounded-none bg-white/10 animate-pulse" />
                    <Skeleton className="h-10 w-36 ml-auto rounded-none bg-white/10 animate-pulse" />
                </div>
            </div>

            {/* Game Grid skeletons */}
            <div className="game-grid">
                {Array.from({ length: 12 }).map((_, i) => (
                    <GameCardSkeleton key={i} />
                ))}
            </div>
        </div>
    </div>
);
