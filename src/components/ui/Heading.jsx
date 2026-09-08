import React from 'react';

/**
 * A unified Heading component for the application.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children
 * @param {string} [props.className] - Additional Tailwind classes
 * @param {string} [props.as='h1'] - The HTML tag to use (h1, h2, etc.)
 */

/* Two size utilities on one element are resolved by stylesheet order, not by where
   they sit in the class string, so this component's own `text-[24px] lg:text-[36px]`
   and a caller's `text-3xl lg:text-5xl` fought unpredictably. The default size is
   emitted only when the caller has not supplied one. */
const SETS_SIZE = /(?:^|\s)(?:sm:|md:|lg:|xl:)?text-(?:\[|(?:xs|sm|base|lg|xl|\d?xl)\b)/;

export default function Heading({ children, className = "", as: Tag = "h1", style }) {
  const size = SETS_SIZE.test(className) ? '' : 'text-[24px] lg:text-[36px]';

  return (
    <Tag
      className={`lh-display ${size} leading-[0.95] font-normal text-white m-0 ${className}`}
      style={style}
    >
      {children}
    </Tag>
  );
}
