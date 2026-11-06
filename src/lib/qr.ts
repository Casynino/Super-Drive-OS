import QRCode from "qrcode";

/**
 * What the QR codes say. Item codes carry only a random, non-guessable token (no prices, no names): the app looks
 * everything up after the scan. The SDOI / SDOP prefix is not tied to any web address, so printed labels keep
 * working if the site moves.
 */
export const ITEM_QR_PREFIX = "SDOI:";
export const PRODUCT_QR_PREFIX = "SDOP:";
export const PICKUP_QR_PREFIX = "SDOPU:";
export const itemQrText = (token: string) => `${ITEM_QR_PREFIX}${token}`;
export const pickupQrText = (token: string) => `${PICKUP_QR_PREFIX}${token}`;
export const productQrText = (barcode: string) => `${PRODUCT_QR_PREFIX}${barcode}`;

/** A QR code as an SVG string (dark modules on white, with a quiet zone), made on the server so it prints sharp at any size. */
export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#000000", light: "#ffffff" } });
}
