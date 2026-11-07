/**
 * A Winga takes goods on credit but must pay within 3 days (Nino 2026-11-08: "he can get up to 3 days, but he must pay today or
 * within 3; if he does not pay, the shop must not give him more goods"). The till uses this as the longest pay period for goods a
 * Winga takes at the till, even when a longer number of days is stored on his record.
 */
export const WINGA_MAX_DAYS = 3;
