import { useEffect, useRef } from 'react';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// One dialog shell for the result popup, the document viewer, and the delete
// confirmation. Focus starts inside, Tab stays inside, Escape closes, and
// focus returns to whatever opened the dialog.
export function Modal({ label, describedBy, small, marker, onClose, children }) {
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    const opener = document.activeElement;
    const panel = panelRef.current;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusables = () => (panel ? [...panel.querySelectorAll(FOCUSABLE)] : []);
    const start = panel?.querySelector('input, textarea, select') || focusables()[0];
    if (start) start.focus();
    else if (panel) panel.focus();
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current?.(); return; }
      if (e.key === 'Tab') {
        const items = focusables();
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      if (opener && typeof opener.focus === 'function') opener.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onClick={() => closeRef.current?.()}>
      <div ref={panelRef} tabIndex={-1} className={small ? 'modal modal-small' : 'modal'} role="dialog" aria-modal="true" aria-label={label} {...(describedBy ? { 'aria-describedby': describedBy } : {})} {...(marker ? { [marker]: '' } : {})} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
