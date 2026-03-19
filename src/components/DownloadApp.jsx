import { QRCodeSVG } from 'qrcode.react';

const DOWNLOAD_URL = 'https://billtap.app/download';
const APP_STORE_URL = 'https://apps.apple.com/billtap';
const GOOGLE_PLAY_URL = 'https://play.google.com/store/billtap';

const DownloadApp = () => {
  return (
    <section className="py-20 px-5 bg-white text-center" aria-labelledby="download-heading">
      <div className="max-w-3xl mx-auto">
        <h2 id="download-heading" className="text-3xl sm:text-4xl font-black text-gray-900 mb-3">
          Get BillTap on your phone
        </h2>
        <p className="text-lg text-gray-500 mb-10">Available for iPhone and Android</p>

        {/* App store badges */}
        <div className="flex flex-wrap justify-center gap-4 mb-12">
          <a
            href={APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Download BillTap on the App Store (opens in new tab)"
            className="flex items-center gap-3 bg-black text-white px-6 py-3 rounded-xl hover:bg-gray-900 transition-colors shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#667eea] min-h-[44px]"
          >
            <svg viewBox="0 0 24 24" className="w-7 h-7 fill-white shrink-0" aria-hidden="true">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11"/>
            </svg>
            <span className="text-left">
              <span className="block text-xs opacity-75 leading-none">Download on the</span>
              <span className="block text-base font-bold leading-tight">App Store</span>
            </span>
          </a>

          <a
            href={GOOGLE_PLAY_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Get BillTap on Google Play (opens in new tab)"
            className="flex items-center gap-3 bg-black text-white px-6 py-3 rounded-xl hover:bg-gray-900 transition-colors shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#667eea] min-h-[44px]"
          >
            <svg viewBox="0 0 24 24" className="w-7 h-7 fill-white shrink-0" aria-hidden="true">
              <path d="M3.18 23.76c.3.17.64.24.99.2l12.52-7.23-2.69-2.69-10.82 9.72zm16.67-10.15L16.9 11.8l-2.98 2.98 2.98 2.97 2.97-1.72c.85-.5.85-1.71-.02-2.22zM2.01 1.05C1.67 1.4 1.5 1.9 1.5 2.54v18.92c0 .64.17 1.14.52 1.49l.08.08 10.6-10.6v-.25L2.09.97l-.08.08zm11.29 10.97L2.19.9l.8-.46 12.52 7.22-2.21 4.46z"/>
            </svg>
            <span className="text-left">
              <span className="block text-xs opacity-75 leading-none">Get it on</span>
              <span className="block text-base font-bold leading-tight">Google Play</span>
            </span>
          </a>
        </div>

        {/* Desktop QR code */}
        <div className="hidden sm:flex flex-col items-center gap-4">
          <p className="text-gray-500 text-sm font-medium">On desktop? Scan to download:</p>
          <div className="p-4 bg-white rounded-2xl shadow-lg border border-gray-100 inline-block">
            <QRCodeSVG
              value={DOWNLOAD_URL}
              size={140}
              bgColor="#ffffff"
              fgColor="#1a1a2e"
              level="M"
              aria-label="QR code to download BillTap"
            />
          </div>
          <p className="text-xs text-gray-400">{DOWNLOAD_URL}</p>
        </div>
      </div>
    </section>
  );
};

export default DownloadApp;