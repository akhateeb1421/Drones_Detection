/**
 * DEPRECATED — kept only so stale imports don't break.
 *
 * The token-based "sign in as admin" flow was replaced by real user
 * accounts: everyone signs in on the LoginPage (username + password) and
 * the SERVER decides the role. See components/LoginPage.tsx and
 * contexts/AuthContext.tsx. This file can be deleted once nothing
 * references it.
 */
export function AdminSignInButton() {
  return null;
}
