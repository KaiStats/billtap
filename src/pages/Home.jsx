import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Receipt, Users, CheckCircle, ArrowRight, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-700 flex flex-col items-center justify-center px-4 text-white">
      <div className="max-w-2xl text-center space-y-8">
        <div className="flex items-center justify-center gap-3 mb-2">
          <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur">
            <Receipt className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-5xl font-black tracking-tight">BillTap</h1>
        </div>
        <p className="text-xl text-purple-100 font-medium">
          Split any bill in seconds — snap a receipt, assign items, collect payments.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
          {[
            { icon: Receipt, title: "Scan Receipt", desc: "AI reads every line item instantly" },
            { icon: Users, title: "Assign Items", desc: "Drag items to each person" },
            { icon: CheckCircle, title: "Collect Payments", desc: "Stripe links sent automatically" },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="bg-white/10 backdrop-blur rounded-2xl p-5 border border-white/20">
              <Icon className="w-6 h-6 mb-3 text-purple-200" />
              <div className="font-bold text-lg">{title}</div>
              <div className="text-purple-200 text-sm mt-1">{desc}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Link to={createPageUrl("Dashboard")}>
            <Button size="lg" className="bg-white text-purple-700 hover:bg-purple-50 font-bold text-base px-8 rounded-xl shadow-lg">
              Go to Dashboard <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </Link>
          <Link to={createPageUrl("NewReceipt")}>
            <Button size="lg" className="bg-purple-500 hover:bg-purple-400 border border-white/30 font-bold text-base px-8 rounded-xl">
              <Zap className="mr-2 w-5 h-5" /> Split a Bill
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}