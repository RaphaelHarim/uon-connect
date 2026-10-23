import type { Permission, PlatformRole } from '@uon/shared';

const ADMIN: Permission[] = [
  'org.manage',
  'users.manage',
  'tickets.config.manage',
  'settings.manage',
  'integrations.read',
  'admin.dashboard',
];

/**
 * Role → permission mapping. Note what is *not* here: no platform role grants reading
 * tickets, conversations or files. Content access is always decided per resource.
 */
export const ROLE_PERMISSIONS: Record<PlatformRole, Permission[]> = {
  platform_admin: ADMIN,
  auditor: ['audit.read', 'security.read', 'admin.dashboard'],
  supreme_admin: [
    ...ADMIN,
    'users.manage_privileged',
    'roles.grant.platform_admin',
    'roles.grant.auditor',
    'audit.read',
    'security.read',
    'sessions.revoke',
  ],
};

/** Only the founder account may designate (or remove) other Supreme Admins. */
export const FOUNDER_PERMISSIONS: Permission[] = ['roles.grant.supreme_admin'];

export function permissionsFor(roles: Iterable<PlatformRole>, isFounder: boolean): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r]) out.add(p);
  if (isFounder) for (const p of FOUNDER_PERMISSIONS) out.add(p);
  return out;
}

export function grantPermissionFor(role: PlatformRole): Permission {
  return `roles.grant.${role}` as Permission;
}
