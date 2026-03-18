import React, { useState } from 'react';

export default function TaxToggle({ taxAmount, onToggle }) {
  const [includeTax, setIncludeTax] = useState(true);

  const handleToggle = () => {
    const newValue = !includeTax;
    setIncludeTax(newValue);
    onToggle(newValue);
  };

  return (
    <div className="flex items-center justify-between px-4 py-4 bg-surface rounded-xl mb-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="tax-toggle" className="text-base font-semibold text-foreground">Include Tax</label>
        <div className="text-sm text-muted-foreground">
          ${taxAmount.toFixed(2)} tax
        </div>
      </div>

      <button
        id="tax-toggle"
        className={`relative w-14 h-8 rounded-full transition-colors ${
          includeTax ? 'bg-brand' : 'bg-muted'
        }`}
        onClick={handleToggle}
        role="switch"
        aria-checked={includeTax}
        aria-label={`${includeTax ? 'Exclude' : 'Include'} tax in split`}
      >
        <div
          className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-md transition-transform ${
            includeTax ? 'translate-x-6' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}