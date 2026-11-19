// Static menu for Slice 1. From Slice 2 items are filtered by the user's permissions.
export interface NavLinkItem {
  kind: 'link';
  path: string;
  label: string;
  title?: string; // page heading when different from the label
  sub?: boolean;
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
  { kind: 'link', path: '/hand-hygiene/new', label: 'New session', sub: true },
  { kind: 'link', path: '/hand-hygiene/sessions', label: 'Sessions', sub: true },
  { kind: 'link', path: '/hand-hygiene/dashboard', label: 'Dashboard', sub: true },
  { kind: 'link', path: '/hand-hygiene/targets', label: 'Ward targets', sub: true },
  { kind: 'link', path: '/hand-hygiene/link-nurses', label: 'Link nurses', sub: true },
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
  { kind: 'link', path: '/reports', label: 'Reports centre' },
  { kind: 'link', path: '/admin/users', label: 'Users' },
  { kind: 'link', path: '/admin/roles', label: 'Roles & permissions' },
  { kind: 'link', path: '/admin/masters', label: 'Masters' },
];

export const NAV_LINKS = NAV.filter((e): e is NavLinkItem => e.kind === 'link');
