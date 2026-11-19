// Menu definition. Items with `perm` show only for users holding that permission.
export interface NavLinkItem {
  kind: 'link';
  path: string;
  label: string;
  title?: string; // page heading when different from the label
  sub?: boolean;
  perm?: string; // permission code required to see the item
  lnLabel?: string; // label shown to link nurses instead
}
export interface NavGroup {
  kind: 'group';
  label: string;
}
export interface NavSoon {
  kind: 'soon';
  label: string;
}
export type NavEntry = NavLinkItem | NavGroup | NavSoon;

export const NAV: NavEntry[] = [
  { kind: 'link', path: '/', label: 'Home', title: 'Quality overview' },
  { kind: 'group', label: 'Hand Hygiene' },
  { kind: 'link', path: '/hand-hygiene/new', label: 'New session', sub: true, perm: 'record' },
  {
    kind: 'link',
    path: '/hand-hygiene/sessions',
    label: 'Sessions',
    sub: true,
    lnLabel: 'My sessions',
  },
  {
    kind: 'link',
    path: '/hand-hygiene/dashboard',
    label: 'Dashboard',
    sub: true,
    perm: 'dash',
    lnLabel: 'My wards',
  },
  {
    kind: 'link',
    path: '/hand-hygiene/targets',
    label: 'Ward targets',
    sub: true,
    perm: 'targets',
  },
  { kind: 'link', path: '/hand-hygiene/link-nurses', label: 'Link nurses', sub: true, perm: 'ln' },
  { kind: 'link', path: '/hand-hygiene/sheet', label: 'Printable sheet', sub: true },
  { kind: 'group', label: 'Other modules' },
  ...[
    'NABH Readiness',
    'Audits & Checklists',
    'CAPA',
    'MRD Deficiency',
    'Incidents',
    'Documents',
  ].map((label): NavSoon => ({ kind: 'soon', label })),
  { kind: 'group', label: 'Platform' },
  { kind: 'link', path: '/reports', label: 'Reports centre', perm: 'reports' },
  { kind: 'link', path: '/admin/users', label: 'Users', perm: 'users' },
  { kind: 'link', path: '/admin/roles', label: 'Roles & permissions', perm: 'users' },
  { kind: 'link', path: '/admin/audit-log', label: 'Audit log', perm: 'users' },
  { kind: 'link', path: '/admin/masters', label: 'Masters', perm: 'masters' },
];

export const NAV_LINKS = NAV.filter((e): e is NavLinkItem => e.kind === 'link');

export const LINK_NURSE_ROLE = 'link_nurse';

/** Entries a user may see: permission-gated links, and groups that still have content. */
export function visibleNav(can: (p: string) => boolean): NavEntry[] {
  const allowed = NAV.filter((e) => e.kind !== 'link' || !e.perm || can(e.perm));
  return allowed.filter((e, i) => {
    if (e.kind !== 'group') return true;
    const next = allowed[i + 1];
    return next !== undefined && next.kind !== 'group';
  });
}
