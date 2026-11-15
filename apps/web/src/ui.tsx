import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{title}</summary>{open && children}
  </details>;
}

export function SectionHeading({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="ui-section-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="ui-heading-actions">{actions}</div>}
    </div>
  );
}

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";
export function StatusBadge({
  tone = "neutral",
  children,
}: {
  tone?: StatusTone;
  children: ReactNode;
}) {
  return <span className={`ui-status tone-${tone}`}>{children}</span>;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ui-empty" role="status">
      <b>{title}</b>
      {description && <p>{description}</p>}
      {action && <div>{action}</div>}
    </div>
  );
}

export function Pagination({
  page,
  pages,
  onChange,
  disabled = false,
  label = "Listenseiten",
}: {
  page: number;
  pages: number;
  onChange: (page: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  if (pages <= 1) return null;
  return (
    <nav className="ui-pagination" aria-label={label}>
      <button disabled={disabled || page <= 1} onClick={() => onChange(page - 1)}>
        ← Zurück
      </button>
      <span aria-live="polite">Seite {page} von {pages}</span>
      <button disabled={disabled || page >= pages} onClick={() => onChange(page + 1)}>
        Weiter →
      </button>
    </nav>
  );
}

/** Native modal: focus trapping and background inertness are provided by the browser. */
export function DetailPanel({
  title,
  onClose,
  children,
  closeDisabled = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  closeDisabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const panel = dialog.current;
    panel?.showModal();
    heading.current?.focus({ preventScroll: true });
    return () => {
      panel?.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="ui-detail-panel"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        if (!closeDisabled) onClose();
      }}
    >
      <div className="ui-panel-header">
        <h2 id={id} ref={heading} tabIndex={-1}>{title}</h2>
        <button type="button" disabled={closeDisabled} onClick={onClose}>
          Schließen
        </button>
      </div>
      <div className="ui-panel-body">{children}</div>
    </dialog>
  );
}
