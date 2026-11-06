import type { CSSProperties } from "react";
import Powertrain from "./Powertrain";
import { Pickup, SportsCar, Tanker } from "./Vehicles";

// Full-page animated scene behind the sign-in form: a night road with three lanes of different vehicles driving
// past (sports car, pickup with oil barrels, Super Drive Oil tanker), a glowing grid floor, wind streaks, rising oil
// sparks and a working engine with a rev gauge (Powertrain). Pure SVG + CSS, decorative, aria-hidden.
// Layout numbers live in login.css. Each lane: --b ground line, --k size, --w width ratio, --d lap time, --s offset.

const vars = (v: Record<string, string>) => v as CSSProperties;

const DOTS = [
  ["8%", "11s", "-2s"], ["19%", "14s", "-9s"], ["31%", "10s", "-5s"], ["43%", "16s", "-12s"], ["55%", "12s", "-1s"],
  ["66%", "15s", "-7s"], ["77%", "11s", "-10s"], ["88%", "13s", "-4s"], ["95%", "17s", "-14s"],
];
const STREAKS = [
  ["68%", "170px", "3.4s", "-0.6s"], ["74%", "100px", "2.4s", "-1.8s"], ["80%", "240px", "4.2s", "-2.8s"],
  ["86%", "140px", "3s", "-1.2s"], ["92%", "200px", "3.8s", "-2.2s"], ["97%", "110px", "2.6s", "-0.4s"],
];

const LANES = [
  { Vehicle: Pickup, b: "28%", k: "0.62", w: "1", d: "15s", s: "-9s", stripe: "0.25", stripeD: "1.6s" },
  { Vehicle: SportsCar, b: "18%", k: "1", w: "1", d: "9s", s: "-3s", stripe: "0.4", stripeD: "0.9s" },
  { Vehicle: Tanker, b: "6%", k: "0.86", w: "1.263", d: "19s", s: "-6s", stripe: "0.55", stripeD: "0.6s" },
];

export default function LoginScene() {
  return (
    <div className="ls" aria-hidden="true">
      <Powertrain />
      {DOTS.map(([l, d, s], i) => (
        <span key={i} className="ls-dot" style={vars({ "--l": l, "--d": d, "--s": s })} />
      ))}
      <div className="ls-horizon" />
      <div className="ls-floor">
        <div className="ls-grid" />
      </div>
      {STREAKS.map(([t, w, d, s], i) => (
        <span key={i} className="ls-streak" style={vars({ "--t": t, "--w": w, "--d": d, "--s": s })} />
      ))}
      {LANES.map(({ Vehicle, b, k, w, d, s, stripe, stripeD }) => (
        <div key={b}>
          <div className="ls-lane" style={vars({ "--b": b, "--o": stripe, "--d": stripeD })} />
          <div className="ls-veh" style={vars({ "--b": b, "--k": k, "--w": w, "--d": d, "--s": s })}>
            <Vehicle />
          </div>
        </div>
      ))}
    </div>
  );
}
