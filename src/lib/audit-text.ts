// Turns an audit code like "sale.create" or "auth.login" into a sentence a person can read.
const AUTH: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.logout": "Signed out",
  "auth.login_failed": "Wrong password",
  "auth.locked": "Locked out after 5 wrong passwords",
  "auth.login_unknown": "Tried to sign in with an unknown email",
  "auth.profile_updated": "Changed their own details",
  "auth.password_changed": "Changed their password",
};
const VERB: Record<string, string> = { create: "created", update: "updated", delete: "removed", import: "imported", approve: "approved", reject: "rejected", cancel: "cancelled", reprint: "reprinted" };

export function describeAction(action: string): string {
  if (AUTH[action]) return AUTH[action]!;
  const [domain = "", ...rest] = action.split(".");
  const verb = rest.join(" ").replace(/_/g, " ");
  const d = domain.replace(/_/g, " ");
  return `${d.charAt(0).toUpperCase()}${d.slice(1)} ${VERB[verb] ?? verb}`.trim();
}
