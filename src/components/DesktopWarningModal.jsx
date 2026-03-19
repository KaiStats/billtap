import { QRCodeSVG } from 'qrcode.react';

export default function DesktopWarningModal({ url }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="desktop-modal-title"
    >
      <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full p-8 text-center">
        <div className="text-5xl mb-4">📱</div>
        <h2 id="desktop-modal-title" className="text-xl font-black text-gray-900 mb-2">
          BillTap works best on mobile
        </h2>
        <p className="text-gray-500 mb-6 text-sm">
          Scan this QR code with your phone to continue
        </p>
        <div className="flex justify-center mb-6">
          <div className="p-3 bg-white rounded-2xl shadow border border-gray-100 inline-block">
            <QRCodeSVG
              value={url}
              size={160}
              bgColor="#ffffff"
              fgColor="#1a1a2e"
              level="M"
              aria-label="QR code to open BillTap on your phone"
            />
          </div>
        </div>
        <p className="text-xs text-gray-400 break-all">{url}</p>
        <a
          href={url}
          className="mt-4 block text-[#667eea] text-sm underline hover:opacity-80"
        >
          Or continue on desktop anyway →
        </a>
      </div>
    </div>
  );
}