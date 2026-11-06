/**
 * Labels, QR codes and scanning are switched OFF for now (Nino, 2026-11-06: "no labels, no QR code, remove the scan thing for now").
 * Only the screens are hidden. The piece records (item numbers and their history), the codes in the database and all the code stay,
 * so nothing is lost and turning this on again brings everything back exactly as it was.
 */
export const LABELS_ENABLED = false;

/**
 * The piece-by-piece list (every single bottle with its number and status) is hidden too: nobody counts or scans piece by piece,
 * so the screens show quantities only (in the shop, with resellers, sold, damaged). The piece records are still kept behind the scenes.
 */
export const PIECE_LIST_ENABLED = false;
