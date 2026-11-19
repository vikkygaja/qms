import type { ItemStatus } from '../api/types';
import s from './ui.module.css';

/** Active / Inactive with a text label and a filled or hollow marker (never colour alone). */
export function StatusPill({ status }: { status: ItemStatus }) {
  const on = status === 'Active';
  return <span className={`${s.pill} ${on ? s.pillOn : s.pillOff}`}>{status}</span>;
}
