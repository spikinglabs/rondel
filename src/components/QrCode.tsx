import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/**
 * A QR code drawn in the browser. The meeting link carries its encryption key, so it is never sent
 * to a QR service. Always dark on white with a quiet zone, so phone cameras read it in dark mode too.
 */
export function QrCode({ text, size = 220, label }: { text: string; size?: number; label: string }) {
  const { n, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { n, path: d };
  }, [text]);
  return (
    <svg className="qr" role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${n + 8} ${n + 8}`} shapeRendering="crispEdges">
      <rect width={n + 8} height={n + 8} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
