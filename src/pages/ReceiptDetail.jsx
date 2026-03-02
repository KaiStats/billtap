import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { CheckCircle2, Clock, Copy, ExternalLink, ArrowLeft, Users, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const statusColors = {
  unpaid: "bg-red-100 text-red-700",
  pending: "bg-yellow-100 text-yellow-700",
  paid: "bg-green-100 text-green-700",
};

export default function ReceiptDetail() {
  const [receipt, setReceipt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generatingLinks, setGeneratingLinks] = useState(false);
  const [copied, setCopied] = useState(null);

  const receiptId = new URLSearchParams(window.location.search).get("id");

  useEffect(() => {
    if (receiptId) {
      base44.entities.Receipt.filter({ id: receiptId }).then((data) => {
        setReceipt(data[0] || null);
        setLoading(false);
      });
    }
  }, [receiptId]);

  const generatePaymentLinks = async () => {
    if (!receipt) return;
    setGeneratingLinks(true);

    const updatedParticipants = await Promise.all(
      (receipt.participants || []).map(async (p) => {
        if (p.stripe_payment_link) return p;
        try {
          const res = await base44.functions.invoke("createStripePaymentLink", {
            amount: p.amount_owed,
            participantName: p.name,
            receiptTitle: receipt.title,
            receiptId: receipt.id,
          });
          return { ...p, stripe_payment_link: res.data?.payment_link || null };
        } catch {
          return p;
        }
      })
    );

    const updated = await base44.entities.Receipt.update(receipt.id, {
      participants: updatedParticipants,
    });
    setReceipt(updated);
    setGeneratingLinks(false);
  };

  const markAsPaid = async (idx) => {
    const updatedParticipants = receipt.participants.map((p, i) =>
      i === idx ? { ...p, payment_status: "paid" } : p
    );
    const allPaid = updatedParticipants.every(p => p.payment_status === "paid");
    const updated = await base44.entities.Receipt.update(receipt.id, {
      participants: updatedParticipants,
      status: allPaid ? "completed" : "assigned",
    });
    setReceipt(updated);
  };

  const copyLink = (link, idx) => {
    navigator.clipboard.writeText(link);
    setCopied(idx);
    setTimeout(() => setCopied(null), 2000);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading...</div>;
  if (!receipt) return <div className="min-h-screen flex items-center justify-center text-gray-500">Receipt not found.</div>;

  const paid = (receipt.participants || []).filter(p => p.payment_status === "paid").length;
  const total = (receipt.participants || []).length;
  const hasLinks = (receipt.participants || []).some(p => p.stripe_payment_link);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link to={createPageUrl("Dashboard")}>
            <Button variant="ghost" size="sm" className="rounded-xl">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
          </Link>
        </div>

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-black text-gray-900">{receipt.title}</h1>
            <div className="flex items-center gap-3 mt-2 text-gray-500 text-sm">
              <span className="flex items-center gap-1"><Users className="w-4 h-4" /> {total} people</span>
              <span className="flex items-center gap-1"><Receipt className="w-4 h-4" /> ${(receipt.total_amount || 0).toFixed(2)} total</span>
              <span className="font-semibold text-green-600">{paid}/{total} paid</span>
            </div>
          </div>
          <Badge className={receipt.status === "completed" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}>
            {receipt.status}
          </Badge>
        </div>

        {/* Receipt image */}
        {receipt.image_url && (
          <Card className="rounded-2xl border-0 shadow-sm overflow-hidden">
            <img src={receipt.image_url} alt="Receipt" className="w-full max-h-64 object-contain bg-gray-100" />
          </Card>
        )}

        {/* Items */}
        {(receipt.items || []).length > 0 && (
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardHeader className="pb-2 pt-5 px-5">
              <CardTitle className="text-base">Line Items</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-2">
              {receipt.items.map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-gray-700">{item.quantity > 1 ? `${item.quantity}x ` : ""}{item.name}</span>
                  <span className="font-semibold text-gray-900">${(item.price * (item.quantity || 1)).toFixed(2)}</span>
                </div>
              ))}
              {receipt.tax > 0 && (
                <div className="flex justify-between text-sm text-gray-500 pt-1 border-t">
                  <span>Tax</span><span>${receipt.tax.toFixed(2)}</span>
                </div>
              )}
              {receipt.tip > 0 && (
                <div className="flex justify-between text-sm text-gray-500">
                  <span>Tip</span><span>${receipt.tip.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-black text-base pt-2 border-t">
                <span>Total</span><span className="text-purple-700">${(receipt.total_amount || 0).toFixed(2)}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Participants */}
        <Card className="rounded-2xl border-0 shadow-sm">
          <CardHeader className="pb-2 pt-5 px-5 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Who owes what</CardTitle>
            {!hasLinks && (
              <Button
                size="sm"
                onClick={generatePaymentLinks}
                disabled={generatingLinks}
                className="bg-purple-600 hover:bg-purple-700 rounded-lg text-xs"
              >
                {generatingLinks ? "Generating..." : "Generate Payment Links"}
              </Button>
            )}
          </CardHeader>
          <CardContent className="px-5 pb-5 space-y-3">
            {(receipt.participants || []).map((p, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                <div>
                  <div className="font-semibold text-gray-900">{p.name}</div>
                  {p.email && <div className="text-xs text-gray-400">{p.email}</div>}
                  <div className="text-purple-700 font-black text-lg mt-0.5">${(p.amount_owed || 0).toFixed(2)}</div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge className={statusColors[p.payment_status] || statusColors.unpaid}>
                    {p.payment_status === "paid" ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <Clock className="w-3 h-3 mr-1" />}
                    {p.payment_status}
                  </Badge>
                  <div className="flex gap-1">
                    {p.stripe_payment_link && (
                      <>
                        <Button size="sm" variant="outline" className="h-7 text-xs rounded-lg" onClick={() => copyLink(p.stripe_payment_link, i)}>
                          {copied === i ? "Copied!" : <><Copy className="w-3 h-3 mr-1" /> Copy</>}
                        </Button>
                        <a href={p.stripe_payment_link} target="_blank" rel="noopener noreferrer">
                          <Button size="sm" variant="outline" className="h-7 text-xs rounded-lg">
                            <ExternalLink className="w-3 h-3" />
                          </Button>
                        </a>
                      </>
                    )}
                    {p.payment_status !== "paid" && (
                      <Button size="sm" onClick={() => markAsPaid(i)} className="h-7 text-xs bg-green-600 hover:bg-green-700 rounded-lg">
                        Mark Paid
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}