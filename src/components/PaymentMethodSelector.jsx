import { useState } from 'react';
import { Check } from 'lucide-react';

export default function PaymentMethodSelector({ onMethodChange }) {
  const [selectedMethod, setSelectedMethod] = useState('apple-pay');

  const methods = [
    {
      value: 'apple-pay',
      icon: '🍎',
      title: 'Apple Pay',
      subtitle: 'Fast & secure'
    },
    {
      value: 'google-pay',
      icon: 'G',
      title: 'Google Pay',
      subtitle: 'Fast & secure'
    },
    {
      value: 'credit-card',
      icon: '💳',
      title: 'Credit Card',
      subtitle: 'Visa, Mastercard, Amex'
    }
  ];

  const handleSelect = (method) => {
    setSelectedMethod(method);
    onMethodChange(method);
  };

  return (
    <fieldset className="py-4">
      <legend className="text-base font-semibold text-foreground mb-3">
        Payment Method
      </legend>

      <div className="flex flex-col gap-3" role="group" aria-labelledby="payment-method-legend">
        {methods.map(method => (
          <button
            key={method.value}
            onClick={() => handleSelect(method.value)}
            aria-label={`Pay with ${method.title}`}
            aria-pressed={selectedMethod === method.value}
            className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all active:scale-[0.99] ${
              selectedMethod === method.value
                ? 'border-brand bg-brand-muted'
                : 'border-border bg-surface-raised hover:border-muted'
            }`}
          >
            <div
              className={`w-12 h-12 rounded-lg flex items-center justify-center text-2xl flex-shrink-0 ${
                selectedMethod === method.value ? 'bg-brand text-white' : 'bg-surface'
              }`}
              aria-hidden="true"
            >
              {method.icon}
            </div>

            <div className="flex-1 text-left">
              <div className="text-base font-semibold text-foreground">
                {method.title}
              </div>
              <div className="text-sm text-muted-foreground">
                {method.subtitle}
              </div>
            </div>

            <div
              className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                selectedMethod === method.value
                  ? 'border-brand bg-brand'
                  : 'border-border'
              }`}
            >
              {selectedMethod === method.value && (
                <Check className="w-4 h-4 text-white" />
              )}
            </div>
          </button>
        ))}
      </div>
    </fieldset>
  );
}