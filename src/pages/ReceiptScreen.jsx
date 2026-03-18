import { useState } from 'react';
import TipSelector from '@/components/TipSelector';
import TaxToggle from '@/components/TaxToggle';
import SplitTypeSelector from '@/components/SplitTypeSelector';
import PeopleSelector from '@/components/PeopleSelector';
import PaymentMethodSelector from '@/components/PaymentMethodSelector';
import { Button } from '@/components/ui/button';
import { Share2 } from 'lucide-react';
import { useScrollBehavior } from '@/hooks/useScrollBehavior';

export default function ReceiptScreen() {
  useScrollBehavior();
  const [tip, setTip] = useState(0);
  const [includeTax, setIncludeTax] = useState(true);
  const [splitType, setSplitType] = useState('itemized');
  const [peopleCount, setPeopleCount] = useState(4);
  const [paymentMethod, setPaymentMethod] = useState('apple-pay');

  const subtotal = 42.50;
  const tax = 3.77;
  const total = subtotal + (includeTax ? tax : 0) + tip;
  const perPerson = splitType === 'even' ? total / peopleCount : total / 2;

  const handleShare = async () => {
    const shareText = `Split Bill Summary\n\nSubtotal: $${subtotal.toFixed(2)}\n${includeTax ? `Tax: $${tax.toFixed(2)}\n` : ''}${tip > 0 ? `Tip: $${tip.toFixed(2)}\n` : ''}\nTotal: $${total.toFixed(2)}\n\nPer Person: $${perPerson.toFixed(2)}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Split Bill',
          text: shareText
        });
      } catch (err) {
        if (err.name !== 'AbortError') console.error('Share failed:', err);
      }
    } else {
      await navigator.clipboard.writeText(shareText);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-surface-raised border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-black text-foreground">Split Bill</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Receipt Summary Card */}
        <div className="bg-card rounded-xl border border-border p-6">
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-semibold text-foreground">${subtotal.toFixed(2)}</span>
            </div>
            {includeTax && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Tax</span>
                <span className="font-semibold text-foreground">${tax.toFixed(2)}</span>
              </div>
            )}
            {tip > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Tip</span>
                <span className="font-semibold text-foreground">${tip.toFixed(2)}</span>
              </div>
            )}
            <div className="border-t border-border pt-3 flex justify-between items-center">
              <span className="font-semibold text-foreground">Total</span>
              <span className="text-2xl font-black text-brand">${total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Tax Toggle */}
        <div>
          <TaxToggle taxAmount={tax} onToggle={setIncludeTax} />
        </div>

        {/* Tip Selector */}
        <div>
          <TipSelector subtotal={subtotal} onTipChange={setTip} />
        </div>

        {/* Split Type Selector */}
        <div>
          <SplitTypeSelector onTypeChange={setSplitType} />
        </div>

        {/* People Selector - Only show for even split */}
        {splitType === 'even' && (
          <div>
            <PeopleSelector initialCount={4} onCountChange={setPeopleCount} />
          </div>
        )}

        {/* Payment Method Selector */}
        <div>
          <PaymentMethodSelector onMethodChange={setPaymentMethod} />
        </div>

        {/* Action Buttons */}
        <div className="pt-6 space-y-3">
          <Button className="w-full h-14 text-lg font-bold" size="lg">
            Continue to Payment
          </Button>
          <Button 
            variant="outline" 
            className="w-full h-14 text-lg font-bold"
            onClick={handleShare}
          >
            <Share2 className="w-5 h-5" />
            Share Bill
          </Button>
        </div>
      </div>
    </div>
  );
}