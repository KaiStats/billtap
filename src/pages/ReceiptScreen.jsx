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
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        <div className="text-5xl mb-4">🧾</div>
        <h1 className="text-2xl font-black text-foreground mb-2">Legacy Screen</h1>
        <p className="text-muted-foreground mb-6">This page is no longer in use. Start a new split from the home screen.</p>
        <Button onClick={() => window.location.href = '/NewReceipt'} className="bg-brand hover:bg-brand/90 text-brand-foreground rounded-xl h-12 px-8 font-bold">
          Start a New Split
        </Button>
      </div>
    </div>
  );
}