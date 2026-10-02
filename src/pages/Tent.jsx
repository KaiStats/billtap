import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { QRCodeSVG } from "qrcode.react";
import { invoke } from "@/api/functions";
import Seo from "@/components/Seo";

/**
 * /tent/<slug> — the print-ready table tent, so the GM is not left to design
 * the one physical piece of setup themselves.
 *
 * One US Letter sheet, folded in half across the middle: the top panel is
 * printed upside down so both faces read right way up once it stands. The QR
 * is the same link the dashboard shows. ?rate=1 prints the rating code
 * (cups, bags, counters) instead of the split code.
 *
 * The copy keeps BillTap optional — "rather pay the usual way? just ask" — so
 * the tent never tells a guest the server is out of the picture.
 */
function Panel({ name, url, rate }) {
  return (
    <div className="tent-panel">
      <p className="tent-eyebrow">{name}</p>
      <h1 className="tent-title">{rate ? "How was everything?" : "Split the check your way"}</h1>
      <div className="tent-qr"><QRCodeSVG value={url} size={210} level="M" /></div>
      <p className="tent-step">
        {rate ? "Scan with your camera · tap the stars" : "Scan with your camera · claim what you ordered · pay your share"}
      </p>
      <p className="tent-small">No app. No account.{rate ? " Takes ten seconds." : " Rather pay the usual way? Just ask your server."}</p>
      <p className="tent-brand">BillTap</p>
    </div>
  );
}

export default function Tent() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const rate = params.get("rate") === "1";
  const [restaurant, setRestaurant] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    invoke("getPublicRestaurant", { slug })
      .then((res) => {
        if (!alive) return;
        const r = res?.data?.restaurant || res?.data;
        if (r?.name) setRestaurant(r); else setMissing(true);
      })
      .catch(() => alive && setMissing(true));
    return () => { alive = false; };
  }, [slug]);

  const url = `${window.location.origin}/r/${slug}${rate ? "/rate" : ""}`;

  return (
    <main className="tent-page">
      <Seo path={`/tent/${slug}`} title="Table tent | BillTap" description="Print-ready BillTap table tent." noindex />
      <style>{`
        .tent-page{background:#f4f4f5;min-height:100vh;color:#111;font-family:system-ui,-apple-system,sans-serif}
        .tent-bar{max-width:640px;margin:0 auto;padding:16px;text-align:center}
        .tent-bar button{padding:10px 22px;border-radius:999px;background:#111;color:#fff;font-weight:700}
        .tent-bar p{font-size:13px;color:#555;margin-top:8px}
        .tent-sheet{width:8.5in;height:11in;margin:0 auto 24px;background:#fff;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.12)}
        .tent-half{flex:1;display:flex;align-items:center;justify-content:center;border-bottom:1px dashed #bbb}
        .tent-half.flip{transform:rotate(180deg)}
        .tent-half:last-child{border-bottom:none}
        .tent-panel{text-align:center;padding:0 .6in}
        .tent-eyebrow{font-size:16px;letter-spacing:.14em;text-transform:uppercase;color:#b7791f;font-weight:700}
        .tent-title{font-size:38px;font-weight:900;line-height:1.05;margin-top:8px}
        .tent-qr{display:inline-block;padding:12px;border:3px solid #111;border-radius:16px;margin-top:18px}
        .tent-step{font-size:17px;font-weight:700;margin-top:14px}
        .tent-small{font-size:13px;color:#555;margin-top:6px}
        .tent-brand{font-size:11px;color:#999;margin-top:10px;letter-spacing:.1em;text-transform:uppercase}
        @page{size:letter;margin:0}
        @media print{.tent-bar{display:none}.tent-page{background:#fff}.tent-sheet{margin:0;box-shadow:none}}
      `}</style>
      <div className="tent-bar">
        <button onClick={() => window.print()} disabled={!restaurant}>Print this tent</button>
        <p>Print on card stock if you can, fold along the dashed line, and stand it on the table. Both sides read the right way up.</p>
        {missing && <p style={{ color: "#b91c1c" }}>We couldn&apos;t find that restaurant. Open this page from your dashboard.</p>}
      </div>
      {restaurant && (
        <div className="tent-sheet">
          <div className="tent-half flip"><Panel name={restaurant.name} url={url} rate={rate} /></div>
          <div className="tent-half"><Panel name={restaurant.name} url={url} rate={rate} /></div>
        </div>
      )}
    </main>
  );
}
