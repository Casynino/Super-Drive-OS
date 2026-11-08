/**
 * Which phone and browser is this? Used only to tell a person the right steps to put the app on the home screen (InstallApp).
 * Pure, so it is tested with real browser strings (device.test.ts). Add a browser here when a person reports one that gets the wrong steps.
 */
export type Device = {
  os: "ios" | "android" | "other";
  browser: "safari" | "chrome" | "samsung" | "huawei" | "firefox" | "edge" | "opera" | "other";
  /** a browser built into another app (WhatsApp, Facebook, Instagram...): it cannot put an app on the home screen, the page must be opened in the real browser first */
  inApp: boolean;
  appName?: string;
};

const IN_APP: [RegExp, string][] = [
  [/FBAN|FBAV|FB_IAB|FBIOS/i, "Facebook"],
  [/Instagram/i, "Instagram"],
  [/WhatsApp/i, "WhatsApp"],
  [/TikTok|musical_ly|BytedanceWebview/i, "TikTok"],
  [/Snapchat/i, "Snapchat"],
  [/Twitter|TwitterAndroid/i, "X"],
  [/LinkedInApp/i, "LinkedIn"],
  [/Line\//i, "LINE"],
  [/MicroMessenger/i, "WeChat"],
  [/Telegram/i, "Telegram"],
  [/GSA\//i, "Google app"],
];

export function detectDevice(ua: string, platform = "", touchPoints = 0): Device {
  // an iPad that asks for the computer version of sites says it is a Mac, but has a touch screen
  const ios = /iPhone|iPad|iPod/.test(ua) || (platform === "MacIntel" && touchPoints > 1);
  const android = /Android/i.test(ua);
  const os: Device["os"] = ios ? "ios" : android ? "android" : "other";

  let appName = IN_APP.find(([re]) => re.test(ua))?.[1];
  // a web view inside an Android app says "; wv)"; one inside an iPhone app has no "Safari/" part (the real Safari and Chrome both do)
  if (!appName && android && /;\s*wv\)/.test(ua)) appName = "this app";
  if (!appName && ios && !/Safari\//.test(ua)) appName = "this app";
  const inApp = !!appName;

  let browser: Device["browser"] = "other";
  if (/SamsungBrowser/i.test(ua)) browser = "samsung";
  else if (/HuaweiBrowser|HMSCore|HarmonyOS|OpenHarmony|ArkWeb|HBPC/i.test(ua)) browser = "huawei";
  else if (/EdgA|EdgiOS|Edg\//.test(ua)) browser = "edge";
  else if (/OPR\/|OPT\/|Opera|OPiOS/i.test(ua)) browser = "opera";
  else if (/Firefox|FxiOS/i.test(ua)) browser = "firefox";
  else if (/UCBrowser|MiuiBrowser|HeyTapBrowser|YaBrowser|VivoBrowser/i.test(ua)) browser = "other"; // phone-maker browsers: they look like Chrome but word their menus their own way
  else if (/CriOS|Chrome\//.test(ua)) browser = "chrome";
  else if (ios && /Safari\//.test(ua)) browser = "safari";
  return { os, browser, inApp, appName };
}
