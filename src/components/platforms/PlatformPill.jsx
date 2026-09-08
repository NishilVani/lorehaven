import { PlatformLogo } from './PlatformLogo';
import { getPlatformLogoUrl, getShortPlatformName } from './platformLogoUtils';
import { Tooltip } from '../ui/Tooltip';

export function PlatformPill({ platform, isSelected, onClick, className = "", isFullWidth = false, showType = false, subtitle = null, children }) {
  const hasIcon = !!getPlatformLogoUrl(platform);
  const fullName = platform?.name || (typeof platform === 'string' ? platform : '');

  const content = (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-pressed={onClick ? !!isSelected : undefined}
      onClick={onClick ? () => onClick(platform) : undefined}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(platform);
        }
      }}
      className={`inline-flex whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white border rounded-none px-3 text-xs justify-start items-center gap-2 min-h-[40px] py-1.5 min-w-0 ${onClick ? 'cursor-pointer' : 'cursor-default'} select-none ${isFullWidth ? 'w-full' : ''} ${
        isSelected
          ? 'bg-white border-white text-black'
          : 'bg-transparent border-white/15 text-white/70 hover:border-white hover:text-white'
      } ${className}`}
    >
      {hasIcon && (
        <div className="-mx-[7px] flex-shrink-0 flex items-center">
          <PlatformLogo platform={platform} className="w-7 h-7 p-[3px] rounded-none" disableTooltip={true} />
        </div>
      )}
      <div className={`${hasIcon ? 'ml-[5px]' : ''} flex flex-col justify-center min-w-0 flex-1 text-left`}>
        <span className={`text-sm truncate ${(showType || subtitle) ? 'leading-tight' : ''}`}>
          {getShortPlatformName(platform)}
        </span>
        {(showType || subtitle) && (
          <span className="lh-label truncate mt-0.5 leading-none">
            {subtitle || platform?.typeLabel || platform?.category || 'Hardware'}
          </span>
        )}
      </div>
      {children}
    </div>
  );

  return (
    <Tooltip text={fullName}>
      {content}
    </Tooltip>
  );
}

export default PlatformPill;
