import { useCallback, useMemo } from 'react';
import { useAuth } from '../context/AppContext';
import { ROLES, normalizeRole, isKnownRole } from './roles';

/**
 * Role-based access (UX gating only; the API no longer checks roles).
 *   can(roles)  -> undefined/null : any signed-in user
 *                  []             : Group Administrator only
 *                  [..]           : those roles (+ Group Administrator)
 *
 * OPEN_UNKNOWN_ROLES: while true, a user whose role code is missing or not in ROLES
 * sees everything, so nobody is ever locked out by a code mismatch.
 * Set to false once every role code in the database is listed in roles.js.
 */
export const OPEN_UNKNOWN_ROLES = true;

export function useAccess() {
  const { user, status } = useAuth();
  const role = normalizeRole(user?.role);
  const isAdmin = role === ROLES.GROUP_ADMIN;
  const openAll = isAdmin || (OPEN_UNKNOWN_ROLES && !isKnownRole(role));

  const can = useCallback((roles) => {
    if (roles === undefined || roles === null) return true;
    if (typeof roles === 'string') return true;      // legacy permission code
    if (openAll) return true;
    return !!role && roles.includes(role);
  }, [role, openAll]);

  return useMemo(() => ({ can, user, role, isAdmin, status }), [can, user, role, isAdmin, status]);
}