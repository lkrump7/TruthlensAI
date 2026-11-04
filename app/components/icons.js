const ICON_PATHS = {
  home: <><path d="M3 11.5 12 4l9 7.5" /><path d="M6 10v10h12V10" /></>,
  image: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m5 17 4.5-4 3 2.5L16 12l3 3" /></>,
  video: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="m10.5 9.8 4.5 2.2-4.5 2.2Z" /></>,
  audio: <><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10v4" /></>,
  cap: <><path d="m12 5 10 4-10 4L2 9Z" /><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5M22 9v5" /></>,
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>,
  users: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19.5c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5M16 5.7a3.2 3.2 0 0 1 0 5.9M17.5 15.3c1.7.6 2.7 1.9 3 4.2" /></>,
  claim: <><path d="M12 4v16" /><path d="M8 20h8" /><path d="M12 6H6m6 0h6" /><path d="M6 6 3.5 12a3.5 3.5 0 0 0 5 0L6 6Zm12 0-2.5 6a3.5 3.5 0 0 0 5 0L18 6Z" /></>,
  excerpt: <><path d="M12 6.5C10 5 7.4 4.4 4 4.4v13.2c3.4 0 6 .6 8 2.1 2-1.5 4.6-2.1 8-2.1V4.4c-3.4 0-6 .6-8 2.1Zm0 0v13.2" /></>,
  website: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z" /></>,
  question: <><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.2 0-2.4-.25-3.4-.7L3 20l.8-3.6A8.5 8.5 0 1 1 21 11.5Z" /><path d="M9.6 9.2A2.6 2.6 0 1 1 13.2 11c-.8.35-1.2 1-1.2 1.9" /><path d="M12 17h.01" /></>,
  library: <><path d="M4 20V6a2 2 0 0 1 2-2h2v16" /><path d="M8 20h12" /><path d="m12.5 5 3.8.9L13 19.4l-3.8-.9Z" /></>,
  history: <><path d="M3.5 8.5A9 9 0 1 1 3 13.5" /><path d="M3.5 3.5v5h5" /><path d="M12 7.5V12l3 2" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.5-4.5" /></>,
  verify: <><path d="M12 3l7 2.8V12c0 4.4-2.9 7.4-7 9-4.1-1.6-7-4.6-7-9V5.8Z" /><path d="m9 11.8 2.2 2.2 4-4.2" /></>,
  download: <><path d="M12 4v10.5" /><path d="m7 10.5 5 5 5-5" /><path d="M4.5 20h15" /></>,
  upload: <><path d="M12 16V5.5" /><path d="m6.8 10.4L12 5.2l5.2 5.2" /><path d="M4.5 20h15" /></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.3-5.6L20 8.5" /><path d="M20 3.8v4.7h-4.7" /></>,
  pause: <><path d="M9.2 5v14M14.8 5v14" /></>,
  play: <><path d="M8 5.4v13.2L18.6 12Z" /></>,
  back: <><path d="M19 12H5.2" /><path d="m11 6.2-5.8 5.8L11 17.8" /></>,
  view: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
  trash: <><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-.8 12.2a2 2 0 0 1-2 1.8H8.8a2 2 0 0 1-2-1.8L6 7" /><path d="M10 11v6M14 11v6" /></>,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  stop: <><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.4M12 19.1v2.4M4.3 4.3l1.7 1.7M18 18l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.3 19.7 6 18M18 6l1.7-1.7" /></>,
  moon: <><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" /></>,
};
ICON_PATHS.book = ICON_PATHS.excerpt;
export function Icon({ name }) {
  return <svg className="icon" data-icon={name} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICON_PATHS[name]}</svg>;
}
