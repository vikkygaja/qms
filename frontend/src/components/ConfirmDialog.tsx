import * as Dialog from '@radix-ui/react-dialog';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import s from './ui.module.css';

/** Small modal that states what will happen and, optionally, requires a reason. */
export function ConfirmDialog({
  title,
  description,
  reasonLabel,
  confirmLabel,
  danger,
  dateField,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: ReactNode;
  /** When set, a reason is required and passed to onConfirm. */
  reasonLabel?: string;
  confirmLabel: string;
  danger?: boolean;
  /** When set, a required date (not after `max`) is asked for and passed to onConfirm. */
  dateField?: { label: string; max: string; defaultValue: string };
  onConfirm: (reason: string, date?: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(dateField?.defaultValue ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (reasonLabel && !reason.trim()) return setError('Enter a reason.');
    if (dateField) {
      if (!date) return setError('Choose a date.');
      if (date > dateField.max) return setError('The date cannot be in the future.');
    }
    setError('');
    setBusy(true);
    try {
      await onConfirm(reason.trim(), dateField ? date : undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && !busy && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content
          ref={ref}
          className={s.dialog}
          onOpenAutoFocus={(e) => {
            // focus the reason box rather than the first button
            const el = ref.current?.querySelector<HTMLElement>('[data-autofocus]');
            if (el) {
              e.preventDefault();
              el.focus();
            }
          }}
        >
          <Dialog.Title asChild>
            <h2>{title}</h2>
          </Dialog.Title>
          <Dialog.Description asChild>
            <div>{description}</div>
          </Dialog.Description>
          <form onSubmit={(e) => void submit(e)} noValidate style={{ display: 'grid', gap: 12 }}>
            {reasonLabel && (
              <label className="f" htmlFor="confirm-reason">
                {reasonLabel}
                <textarea
                  id="confirm-reason"
                  rows={3}
                  data-autofocus
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  aria-invalid={!!error}
                />
              </label>
            )}
            {dateField && (
              <label className="f" htmlFor="confirm-date">
                {dateField.label}
                <input
                  id="confirm-date"
                  type="date"
                  max={dateField.max}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
            )}
            <p role="alert" className="err" hidden={!error}>
              {error}
            </p>
            <div className={s.dialogFoot}>
              <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className={`btn ${danger ? 'danger' : ''}`} disabled={busy}>
                {confirmLabel}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
