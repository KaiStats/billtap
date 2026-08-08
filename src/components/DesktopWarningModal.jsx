import { QRCodeSVG } from 'qrcode.react';

export default function DesktopWarningModal({ url, onDismiss }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="desktop-modal-title"
    >
      <div className="glass-strong rounded-3xl shadow-float max-w-sm w-full p-8 text-center">
        <div className="text-5xl mb-4">📱</div>
        <h2 id="desktop-modal-title" className="font-display text-xl font-bold text-foreground mb-2">
          BillTap works best on mobile
        </h2>
        <p className="text-muted-foreground mb-6 text-sm">
          Scan this QR code with your phone to continue
        </p>
        <div className="flex justify-center mb-6">
          <div className="p-3 bg-white rounded-2xl shadow-glow inline-block">
            <QRCodeSVG
              value={url}
              size={160}
              bgColor="#ffffff"
              fgColor="#070b16"
              level="M"
              aria-label="QR code to open BillTap on your phone"
            />
          </div>
        </div>
        <p className="mono text-xs text-muted-foreground/70 break-all">{url}</p>
        <button
          onClick={onDismiss}
          className="mt-4 block w-full text-primary text-sm underline hover:opacity-80 bg-transparent border-0 cursor-pointer"
        >
          Or continue on desktop anyway →
        </button>
      </div>
    </div>
  );
}