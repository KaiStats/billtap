import { QRCodeSVG } from 'qrcode.react';

const DOWNLOAD_URL = 'https://billtap.app/download';
const APP_STORE_URL = 'https://apps.apple.com/billtap';
const GOOGLE_PLAY_URL = 'https://play.google.com/store/billtap';

const DownloadApp = () => {
  return (
    <section className="py-24 px-5" style={{ background: '#12101e' }} aria-labelledby="download-heading">
      <div className="max-w-3xl mx-auto text-center">
        <span className="inline-block text-xs font-bold uppercase tracking-widest text-cyan-400 mb-5 px-3 py-1 rounded-full border border-cyan-400/30 bg-cyan-400/5">
          Get the app
        </span>
        <h2 id="download-heading" className="text-4xl sm:text-5xl font-black text-white mb-3">
          BillTap in your pocket
        </h2>
        <p className="text-lg text-white/50 mb-12">Works on any phone — no download required. Free to use.</p>



        <div className="hidden sm:flex flex-col items-center gap-4">
          <p className="text-white/40 text-sm font-medium">On desktop? Scan to download:</p>
          <div className="p-4 bg-white rounded-2xl shadow-2xl inline-block">
            <QRCodeSVG value={DOWNLOAD_URL} size={140} bgColor="#ffffff" fgColor="#12101e" level="M" aria-label="QR code to download BillTap" />
          </div>
          <p className="text-xs text-white/25">{DOWNLOAD_URL}</p>
        </div>
      </div>
    </section>
  );
};

export default DownloadApp;