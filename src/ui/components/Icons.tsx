/** Ceyrom icon set — 24px grid, 1.75 stroke, rounded joins. */
import { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = (size = 22) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

const make = (paths: JSX.Element) =>
  function Icon({ size, ...rest }: P) {
    return (
      <svg {...base(size)} {...rest}>
        {paths}
      </svg>
    );
  };

export const IconPlay = make(<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" />);
export const IconStriker = make(
  <>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="4.2" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
  </>,
);
export const IconBot = make(
  <>
    <rect x="5" y="8" width="14" height="10" rx="3" />
    <path d="M12 8V5M9.5 13h.01M14.5 13h.01M10 16h4" />
    <circle cx="12" cy="4" r="1" />
  </>,
);
export const IconPeople = make(
  <>
    <circle cx="9" cy="8.5" r="3" />
    <path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" />
    <circle cx="16.5" cy="9.5" r="2.4" />
    <path d="M15.5 14.6c2.4-.2 4.4 1.1 5 3.9" />
  </>,
);
export const IconGlobe = make(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.4 2.5 3.5 5.3 3.5 8.5s-1.1 6-3.5 8.5c-2.4-2.5-3.5-5.3-3.5-8.5s1.1-6 3.5-8.5z" />
  </>,
);
export const IconTarget = make(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </>,
);
export const IconBook = make(<path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5v13c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5zM12 6v13.5" />);
export const IconUser = make(
  <>
    <circle cx="12" cy="8.5" r="3.6" />
    <path d="M4.5 20c.9-3.8 3.8-5.6 7.5-5.6s6.6 1.8 7.5 5.6" />
  </>,
);
export const IconTrophy = make(<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5c0 3 1.5 4.5 3.7 4.8M16 6h3.5c0 3-1.5 4.5-3.7 4.8M12 13v3.5M8.5 20h7M9.5 16.5h5l.5 3.5h-6z" />);
export const IconGear = make(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" />
    <circle cx="12" cy="12" r="6.3" />
  </>,
);
export const IconPause = make(<path d="M9 5.5v13M15 5.5v13" strokeWidth={2.4} />);
export const IconBack = make(<path d="M15 5l-7 7 7 7" />);
export const IconClose = make(<path d="M6 6l12 12M18 6 6 18" />);
export const IconCopy = make(
  <>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2.2" />
    <path d="M15.5 8.5V6.2A1.7 1.7 0 0 0 13.8 4.5H6.2A1.7 1.7 0 0 0 4.5 6.2v7.6a1.7 1.7 0 0 0 1.7 1.7h2.3" />
  </>,
);
export const IconShare = make(<path d="M12 15V4M8 8l4-4 4 4M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13" />);
export const IconSound = make(<path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />);
export const IconMute = make(<path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3zM16 9.5l5 5M21 9.5l-5 5" />);
export const IconRefresh = make(<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v3.8h-3.8" />);
export const IconBulb = make(<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.8.6 1.1 1.3 1.1 2.2h5c0-.9.3-1.6 1.1-2.2A6 6 0 0 0 12 3z" />);
export const IconReplay = make(<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3.8h3.8M10.5 9v6l4.5-3z" />);
export const IconFlag = make(<path d="M5.5 21V4M5.5 4.5h11l-2 4 2 4h-11" />);
export const IconSmile = make(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 14.5c1.8 2 5.2 2 7 0M9 9.5h.01M15 9.5h.01" />
  </>,
);
export const IconCalendar = make(
  <>
    <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" />
    <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    <circle cx="12" cy="15" r="1.4" fill="currentColor" />
  </>,
);
export const IconLock = make(
  <>
    <rect x="5" y="10.5" width="14" height="10" rx="2.4" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </>,
);
export const IconEye = make(
  <>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const IconQueen = make(
  <>
    <circle cx="12" cy="12" r="8.5" fill="currentColor" fillOpacity={0.15} />
    <circle cx="12" cy="12" r="4" />
  </>,
);
export const IconWifiOff = make(<path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4.5-2.5M19 13a10 10 0 0 0-2.3-1.6M2 9.5a15 15 0 0 1 5-3M12 20h.01M22 9.5a15 15 0 0 0-10-4" />);
