import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { tr } from '../../shared/i18n';
/** #rrggbb ⇄ hue (0–360), saturation and value (0–1). */
export function hexToHsv(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}

export function hsvToHex(h: number, s: number, v: number): string {
  const f = (k: number) => {
    const x = (k + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(x, 4 - x, 1));
  };
  return '#' + [f(5), f(3), f(1)].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));

/**
 * In-app colour picker (the phone's own colour input is basic or missing on some
 * Android versions): saturation/brightness square, hue slider and a hex field.
 * Drag with a finger or mouse; arrow keys move the square's handle.
 */
export function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [text, setText] = useState(value.toUpperCase());
  const square = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Follow outside changes (e.g. a swatch was tapped).
  useEffect(() => {
    if (hsvToHex(...hsv) !== value.toLowerCase()) setHsv(hexToHsv(value));
    setText(value.toUpperCase());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (h: number, s: number, v: number) => {
    setHsv([h, s, v]);
    const hex = hsvToHex(h, s, v);
    setText(hex.toUpperCase());
    onChange(hex);
  };

  const pick = (e: PointerEvent) => {
    const r = square.current!.getBoundingClientRect();
    emit(hsv[0], clamp((e.clientX - r.left) / r.width), 1 - clamp((e.clientY - r.top) / r.height));
  };

  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!d) return;
    e.preventDefault();
    emit(hsv[0], clamp(hsv[1] + d[0]!), clamp(hsv[2] + d[1]!));
  };

  const [h, s, v] = hsv;
  return (
    <div className="color-picker">
      <div
        ref={square}
        className="cp-square"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h} 100% 50%))` }}
        role="slider"
        tabIndex={0}
        aria-label={tr("Color brightness and strength")}
        aria-valuetext={text}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          pick(e);
        }}
        onPointerMove={(e) => dragging.current && pick(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        onKeyDown={onKey}
      >
        <span className="cp-thumb" style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: value }} />
      </div>
      <input
        className="cp-hue"
        type="range"
        min={0}
        max={359}
        value={Math.round(h)}
        onChange={(e) => emit(Number(e.target.value), s || 0.8, v || 0.8)}
        aria-label={tr("Hue")}
      />
      <div className="cp-row">
        <span className="cp-chip" style={{ background: value }} aria-hidden />
        <input
          className="input cp-hex"
          value={text}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          aria-label={tr("Hex color code")}
          onChange={(e) => {
            const t = e.target.value.trim().toUpperCase();
            const next = t.startsWith('#') ? t : `#${t}`;
            setText(next);
            if (/^#[0-9A-F]{6}$/.test(next)) {
              setHsv(hexToHsv(next.toLowerCase()));
              onChange(next.toLowerCase());
            }
          }}
        />
      </div>
    </div>
  );
}
