import { createPageUrl } from "@/utils";
import { useTabNav } from "@/lib/TabNavigationContext";
import { Receipt, Users, CheckCircle, ArrowRight, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-brand to-info flex flex-col items-center justify-center px-4 text-brand-foreground">
      <div className="max-w-2xl text-center space-y-8">
        <div className="flex items-center justify-center gap-3 mb-2">
          <div className="w-14 h-14 bg-brand-foreground/20 rounded-2xl flex items-center justify-center backdrop-blur">
            <Receipt className="w-8 h-8 text-brand-foreground" aria-hidden="true" />
          </div>
          <h1 className="text-5xl font-black tracking-tight">BillTap</h1>
        </div>
        <p className="text-xl text-brand-foreground/80 font-medium">
          Split any bill in seconds — snap a receipt, assign items, collect payments.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
          {[
            { icon: Receipt, title: "Scan Receipt", desc: "AI reads every line item instantly" },
            { icon: Users, title: "Assign Items", desc: "Drag items to each person" },
            { icon: CheckCircle, title: "Collect Payments", desc: "Stripe links sent automatically" },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="bg-brand-foreground/10 backdrop-blur rounded-2xl p-5 border border-brand-foreground/20">
              <Icon className="w-6 h-6 mb-3 text-brand-foreground/70" aria-hidden="true" />
              <div className="font-bold text-lg">{title}</div>
              <div className="text-brand-foreground/70 text-sm mt-1">{desc}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Link to={createPageUrl("Dashboard")}>
            <Button size="lg" className="bg-background text-brand hover:bg-background/90 font-bold text-base px-8 rounded-xl shadow-lg">
              Go to Dashboard <ArrowRight className="ml-2 w-5 h-5" aria-hidden="true" />
            </Button>
          </Link>
          <Link to={createPageUrl("NewReceipt")}>
            <Button size="lg" className="bg-brand-foreground/20 hover:bg-brand-foreground/30 border border-brand-foreground/30 text-brand-foreground font-bold text-base px-8 rounded-xl">
              <Zap className="mr-2 w-5 h-5" aria-hidden="true" /> Split a Bill
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}