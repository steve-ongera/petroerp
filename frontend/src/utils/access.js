/**
 * Access helper (src/utils/access.js).
 *
 * The backend treats a user as "group admin" when is_superuser is true OR the role code is GROUP_ADMIN
 * (User.is_group_admin) and then skips every permission check. This mirrors that rule in the UI so the
 * super user always sees every menu item and can open every page, even if the Permission table was never seeded.
 *
 * UX only: the API still enforces permissions and legal-entity access on every request.
 */
import { useCallback } from 'react';

import { useAuth } from '../context/AppContext';

export function isSuperUser(user) {
  if (!user) return false;
  return Boolean(
    user.is_superuser ||
      user.is_group_admin ||
      user.role === 'GROUP_ADMIN' ||
      user.role === 'SUPERUSER',
  );
}

/** Drop-in replacement for useAuth(): same fields, plus `isAdmin` and an admin-aware `can(perm)`. */
export function useAccess() {
  const auth = useAuth();
  const baseCan = auth.can;
  const isAdmin = isSuperUser(auth.user);

  const can = useCallback(
    (perm) => isAdmin || !perm || (typeof baseCan === 'function' && baseCan(perm)),
    [isAdmin, baseCan],
  );

  return { ...auth, isAdmin, can };
}