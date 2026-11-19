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

/**
 * Einheitliche Bestätigung (Phase 7.0a): Frage oder Folgen, dann „OK“ oder „Abbrechen“.
 * Während der Ausführung sind beide Knöpfe gesperrt; ein Fehler erscheint direkt darunter.
 */
export function ConfirmBar({
  label,
  children,
  onOk,
  onCancel,
  busy = false,
  busyLabel = "Wird ausgeführt …",
  okLabel = "OK",
  error = "",
}: {
  label: string;
  children: ReactNode;
  onOk: () => unknown;
  onCancel: () => void;
  busy?: boolean;
  busyLabel?: string;
  okLabel?: string;
  error?: string;
}) {
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => { ok.current?.focus({ preventScroll: true }); }, []);
  return (
    <div className="notice ui-confirm" role="dialog" aria-label={label}>
      <div className="ui-confirm-text">{children}</div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="service-update-actions">
        <button ref={ok} type="button" className="primary" disabled={busy} onClick={() => void onOk()}>
          {busy ? busyLabel : okLabel}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>Abbrechen</button>
      </div>
    </div>
  );
}

/**
 * Zustand rund um eine Aktion: läuft gerade (mit Kennung), Fehler, Erfolgsmeldung.
 * run() setzt alles zurück, führt aus und liefert true bei Erfolg.
 */
export function useAction() {
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      const message = await fn();
      if (message) setNotice(message);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy("");
    }
  }
  return { busy, error, notice, setError, setNotice, run };
}
