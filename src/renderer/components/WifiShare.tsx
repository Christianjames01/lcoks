import { Clock, Eye, EyeOff, QrCode, ShieldCheck, Wifi } from 'lucide-react';
import qrcode from 'qrcode-generator';
import { useEffect, useMemo, useState } from 'react';
import type { EntryView } from '../../shared/types';
import { wifiOf, wifiQrText } from '../../shared/wifi';
import { api, errorMessage, unwrap } from '../lib/api';
import { Dialog } from './Dialog';
import { useToast } from './Toast';

const SHOW_SECONDS = 60;

/** A QR code as one SVG path (dark modules), with a 4-module quiet zone. */
function QrSvg({ text, size }: { text: string; size: number }) {
  const { d, n } = useMemo(() => {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8']!;
    const qr = qrcode(0, 'M');
    qr.addData(text, 'Byte');
    qr.make();
    const count = qr.getModuleCount();
    let path = '';
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) path += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { d: path, n: count + 8 };
  }, [text]);
  return (
    <svg className="wifi-qr-svg" width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label="QR code to join the Wi-Fi network">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

/**
 * "Share this Wi-Fi" on a Wi-Fi item. The QR code (which contains the password)
 * is only made when the user asks for it, shown full size, and closes by itself.
 */
export function WifiShare({ entry }: { entry: EntryView }) {
  const net = wifiOf(entry);
  const [open, setOpen] = useState(false);
  if (!net) return null;
  return (
    <>
      <div className="wifi-share">
        <span className="wifi-share-icon" aria-hidden>
          <QrCode size={26} strokeWidth={1.7} />
        </span>
        <div className="grow">
          <div className="wifi-share-title">Share this Wi-Fi</div>
          <div className="dim small">A friend scans the code to join. The password stays hidden.</div>
        </div>
        <button type="button" className="btn primary sm" onClick={() => setOpen(true)}>
          <QrCode size={15} aria-hidden /> Show QR code
        </button>
      </div>
      {open && <WifiQrDialog entry={entry} ssid={net.ssid} security={net.security} hidden={net.hidden} onClose={() => setOpen(false)} />}
    </>
  );
}

function WifiQrDialog({ entry, ssid, security, hidden, onClose }: { entry: EntryView; ssid: string; security?: string; hidden: boolean; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [left, setLeft] = useState(SHOW_SECONDS);

  useEffect(() => {
    let gone = false;
    void (async () => {
      try {
        const pw = entry.secrets.password?.set ? await unwrap(api.vault.reveal(entry.id, 'password')) : '';
        if (!gone) {
          setPassword(pw);
          setReady(true);
        }
      } catch (e) {
        toast(errorMessage(e), 'error');
        onClose();
      }
    })();
    return () => {
      gone = true;
      setPassword(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [ready]);
  useEffect(() => {
    if (left <= 0) onClose();
  }, [left, onClose]);

  const text = ready ? wifiQrText({ ssid, password: password ?? '', security, hidden }) : '';
  return (
    <Dialog placement="center" size="narrow" title="Scan to join" subtitle={ssid} onClose={onClose}>
      <div className="wifi-qr">
        {ready ? (
          <div className="wifi-qr-frame">
            <QrSvg text={text} size={260} />
          </div>
        ) : (
          <div className="wifi-qr-frame loading">
            <span className="spinner" aria-label="Making the code" />
          </div>
        )}
        <p className="dim small" style={{ textAlign: 'center', margin: '14px 6px 10px' }}>
          Point the other phone's camera at the code. iPhone and Android join without typing.
        </p>
        <div className="wifi-qr-chips">
          <span className="vl-pill">
            <ShieldCheck size={13} aria-hidden /> Password not shown
          </span>
          <span className="vl-pill">
            <Clock size={13} aria-hidden /> Hides in {Math.max(0, left)} s
          </span>
        </div>
        {showPassword && password && (
          <div className="wifi-qr-pass">
            <Wifi size={14} aria-hidden /> <span className="mono selectable">{password}</span>
          </div>
        )}
        {password ? (
          <button type="button" className="btn block" onClick={() => setShowPassword((v) => !v)} style={{ marginTop: 12 }}>
            {showPassword ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />} {showPassword ? 'Hide password' : 'Show password instead'}
          </button>
        ) : null}
        <button type="button" className="btn primary block" onClick={onClose} style={{ marginTop: 8 }}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
