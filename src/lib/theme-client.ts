/** Colours of the phone's own bars (browser top bar, status bar) so they match the page behind them. Keep in step with globals.css. */
export const THEME_COLOR = { dark: "#0a1220", light: "#f4f6f9" } as const;

/**
 * Switches the night / light look: the class the styles read, the cookie the server reads next time (no flash), and the
 * `theme-color` the phone paints its top bar with, so the bar never stays the old colour.
 */
export function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  document.cookie = `sd-theme=${dark ? "dark" : "light"}; path=/; max-age=31536000; samesite=lax`;
  const color = dark ? THEME_COLOR.dark : THEME_COLOR.light;
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  if (metas.length) metas.forEach((m) => { m.content = color; m.removeAttribute("media"); });
  else {
    const m = document.createElement("meta");
    m.name = "theme-color";
    m.content = color;
    document.head.appendChild(m);
  }
}
