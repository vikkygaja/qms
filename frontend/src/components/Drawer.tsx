import * as Dialog from '@radix-ui/react-dialog';
import { useRef, type ReactNode } from 'react';
import s from './ui.module.css';

/**
 * Right-side slide-over panel built on Radix Dialog (focus trap, Escape, aria labelling).
 * Clicking outside does not close it, so a half-filled form is not lost by accident.
 * The first element marked data-autofocus gets focus when it opens.
 */
export function Drawer({
  title,
  description,
  onClose,
  footer,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content
          ref={ref}
          className={s.drawer}
          onInteractOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => {
            const el = ref.current?.querySelector<HTMLElement>('[data-autofocus]');
            if (el) {
              e.preventDefault();
              el.focus();
            }
          }}
        >
          <div className={s.drawerHead}>
            <div>
              <Dialog.Title asChild>
                <h2>{title}</h2>
              </Dialog.Title>
              <Dialog.Description>{description}</Dialog.Description>
            </div>
            <Dialog.Close className={s.close} aria-label="Close panel">
              <span aria-hidden="true">×</span>
            </Dialog.Close>
          </div>
          <div className={s.drawerBody}>{children}</div>
          <div className={s.drawerFoot}>{footer}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
