import { describe, expect, it } from "vitest";
import { detectDevice } from "./device";

// real user-agent strings of the phones and browsers people use
const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1",
  iphoneEdge: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/130.0.2849.80 Mobile/15E148 Safari/605.1.15",
  iphoneWhatsApp: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  iphoneInstagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.12.108 (iPhone14,5; iOS 18_0; en_US; en; scale=3.00; 1170x2532; 0)",
  ipadDesktopMode: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  pixelChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.102 Mobile Safari/537.36",
  samsungChrome: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.102 Mobile Safari/537.36",
  samsungInternet: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  tecnoChrome: "Mozilla/5.0 (Linux; Android 13; TECNO KJ5 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.100 Mobile Safari/537.36",
  huaweiBrowser: "Mozilla/5.0 (Linux; Android 12; HarmonyOS; NOH-AN00; HMSCore 6.13.0.302) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.196 HuaweiBrowser/15.0.4.312 Mobile Safari/537.36",
  androidFacebook: "Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0.0.38.108;]",
  androidWebView: "Mozilla/5.0 (Linux; Android 12; Infinix X669 Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.193 Mobile Safari/537.36",
  firefoxAndroid: "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
  edgeAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.102 Mobile Safari/537.36 EdgA/130.0.2849.80",
  operaAndroid: "Mozilla/5.0 (Linux; Android 13; TECNO KJ5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 OPR/80.5.4244.78417",
  harmonyArkWeb: "Mozilla/5.0 (Phone; OpenHarmony 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 ArkWeb/4.1.6.1 Mobile",
  miui: "Mozilla/5.0 (Linux; U; Android 13; en-us; Redmi Note 12 Build/TKQ1.221114.001) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 XiaoMi/MiuiBrowser/18.2.20629",
  uc: "Mozilla/5.0 (Linux; U; Android 12; en-US; TECNO KG5 Build/SP1A.210812.016) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.58 UCBrowser/13.5.5.1317 Mobile Safari/537.36",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

describe("detectDevice", () => {
  it("iPhones: Safari, Chrome and Edge can add to the home screen", () => {
    expect(detectDevice(UA.iphoneSafari)).toMatchObject({ os: "ios", browser: "safari", inApp: false });
    expect(detectDevice(UA.iphoneChrome)).toMatchObject({ os: "ios", browser: "chrome", inApp: false });
    expect(detectDevice(UA.iphoneEdge)).toMatchObject({ os: "ios", browser: "edge", inApp: false });
  });
  it("an iPhone app's built-in browser is recognised (WhatsApp, Instagram)", () => {
    expect(detectDevice(UA.iphoneWhatsApp)).toMatchObject({ os: "ios", inApp: true });
    expect(detectDevice(UA.iphoneInstagram)).toMatchObject({ os: "ios", inApp: true, appName: "Instagram" });
  });
  it("an iPad in computer mode still counts as iOS", () => {
    expect(detectDevice(UA.ipadDesktopMode, "MacIntel", 5).os).toBe("ios");
    expect(detectDevice(UA.ipadDesktopMode, "MacIntel", 0).os).toBe("other");
  });
  it("Android: Pixel, Samsung, Tecno / Infinix run Chrome; Samsung and Huawei have their own browsers", () => {
    expect(detectDevice(UA.pixelChrome)).toMatchObject({ os: "android", browser: "chrome", inApp: false });
    expect(detectDevice(UA.samsungChrome)).toMatchObject({ os: "android", browser: "chrome", inApp: false });
    expect(detectDevice(UA.tecnoChrome)).toMatchObject({ os: "android", browser: "chrome", inApp: false });
    expect(detectDevice(UA.samsungInternet)).toMatchObject({ os: "android", browser: "samsung", inApp: false });
    expect(detectDevice(UA.huaweiBrowser)).toMatchObject({ os: "android", browser: "huawei", inApp: false });
    expect(detectDevice(UA.firefoxAndroid)).toMatchObject({ os: "android", browser: "firefox", inApp: false });
    expect(detectDevice(UA.edgeAndroid)).toMatchObject({ os: "android", browser: "edge", inApp: false });
    expect(detectDevice(UA.operaAndroid)).toMatchObject({ os: "android", browser: "opera", inApp: false });
  });
  it("Huawei's newer system (no Android in the string) and the phone-maker browsers get their own steps", () => {
    expect(detectDevice(UA.harmonyArkWeb)).toMatchObject({ browser: "huawei", inApp: false });
    expect(detectDevice(UA.miui)).toMatchObject({ os: "android", browser: "other", inApp: false });
    expect(detectDevice(UA.uc)).toMatchObject({ os: "android", browser: "other", inApp: false });
  });
  it("an Android app's built-in browser is recognised", () => {
    expect(detectDevice(UA.androidFacebook)).toMatchObject({ os: "android", inApp: true, appName: "Facebook" });
    expect(detectDevice(UA.androidWebView)).toMatchObject({ os: "android", inApp: true });
  });
  it("a computer is not a phone", () => {
    expect(detectDevice(UA.windowsChrome)).toMatchObject({ os: "other", browser: "chrome", inApp: false });
  });
});
