import { useEffect, useRef, type ReactNode } from 'react';

/** The Rosewood modal dialog used by School forms. */
export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) ref.current?.showModal(); else ref.current?.close(); }, [open]);
  return <dialog className="rose-dialog" ref={ref} onClose={onClose} aria-label={title}>{open && children}</dialog>;
}
