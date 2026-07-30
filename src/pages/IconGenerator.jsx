import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

const SVG_MARKUP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#0b0b0d"/>
  <rect x="156" y="110" width="200" height="230" rx="12" ry="12" fill="none" stroke="#ffffff" stroke-width="14"/>
  <path d="M156 312 Q166 324 176 312 Q186 324 196 312 Q206 324 216 312 Q226 324 236 312 Q246 324 256 312 Q266 324 276 312 Q286 324 296 312 Q306 324 316 312 Q326 324 336 312 Q346 324 356 312" fill="none" stroke="#ffffff" stroke-width="14" stroke-linecap="round"/>
  <line x1="186" y1="158" x2="290" y2="158" stroke="#ffffff" stroke-width="8" stroke-linecap="round" opacity="0.45"/>
  <line x1="186" y1="184" x2="270" y2="184" stroke="#ffffff" stroke-width="8" stroke-linecap="round" opacity="0.45"/>
  <line x1="186" y1="210" x2="280" y2="210" stroke="#ffffff" stroke-width="8" stroke-linecap="round" opacity="0.45"/>
  <line x1="186" y1="236" x2="265" y2="236" stroke="#ffffff" stroke-width="8" stroke-linecap="round" opacity="0.45"/>
  <polygon points="272,118 238,245 266,245 232,362 290,222 262,222 296,118" fill="#f0b429"/>
</svg>`;

function renderIconToCanvas(canvas, size) {
  const ctx = canvas.getContext("2d");
  canvas.width = size;
  canvas.height = size;

  const svgBlob = new Blob([SVG_MARKUP], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();

  return new Promise((resolve) => {
    img.onload = () => {
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve();
    };
    img.src = url;
  });
}

export default function IconGenerator() {
  const canvas192 = useRef(null);
  const canvas512 = useRef(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    async function render() {
      await renderIconToCanvas(canvas192.current, 192);
      await renderIconToCanvas(canvas512.current, 512);
      setRendered(true);
    }
    render();
  }, []);

  const downloadPNG = (canvasRef, filename) => {
    const canvas = canvasRef.current;
    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-8 p-8">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold">BillTap App Icon Generator</h1>
        <p className="text-muted-foreground text-sm">
          Download these PNGs and place them in <code className="bg-muted px-1 rounded">public/icons/</code>
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-8 items-center">
        {/* 192x192 */}
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm font-semibold text-muted-foreground">icon-192.png (192×192)</p>
          <canvas
            ref={canvas192}
            style={{ width: 192, height: 192, border: "1px solid #e2e8f0", borderRadius: 16 }}
          />
          <Button
            onClick={() => downloadPNG(canvas192, "icon-192.png")}
            disabled={!rendered}
            className="w-full"
          >
            <Download className="w-4 h-4 mr-2" />
            Download icon-192.png
          </Button>
        </div>

        {/* 512x512 — shown at 256px display size */}
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm font-semibold text-muted-foreground">icon-512.png (512×512)</p>
          <canvas
            ref={canvas512}
            style={{ width: 256, height: 256, border: "1px solid #e2e8f0", borderRadius: 24 }}
          />
          <Button
            onClick={() => downloadPNG(canvas512, "icon-512.png")}
            disabled={!rendered}
            className="w-full"
          >
            <Download className="w-4 h-4 mr-2" />
            Download icon-512.png
          </Button>
        </div>
      </div>

      <div className="max-w-md text-center text-xs text-muted-foreground bg-muted rounded-xl p-4 space-y-1">
        <p className="font-semibold">After downloading:</p>
        <p>Place both files in <code>public/icons/</code> — they are already referenced in the manifest and HTML.</p>
        <p>The icon uses your brand gold (#f0b429) on a ink background (#0b0b0d) with a receipt + lightning bolt design.</p>
      </div>
    </div>
  );
}