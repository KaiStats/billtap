import { useState } from 'react';

export default function QuantitySelector({ initialQuantity = 1, onQuantityChange }) {
  const [quantity, setQuantity] = useState(initialQuantity);

  const handleIncrement = () => {
    const newQuantity = Math.min(quantity + 1, 99);
    setQuantity(newQuantity);
    onQuantityChange(newQuantity);
  };

  const handleDecrement = () => {
    const newQuantity = Math.max(quantity - 1, 1);
    setQuantity(newQuantity);
    onQuantityChange(newQuantity);
  };

  return (
    <div className="flex items-center gap-3">
      <div className="text-sm font-semibold text-muted-foreground min-w-fit">
        Quantity
      </div>

      <div className="flex items-center gap-3 bg-surface rounded-lg border border-border px-3 py-2">
        <button
          onClick={handleDecrement}
          disabled={quantity <= 1}
          aria-label="Decrease quantity"
          className="w-8 h-8 rounded-md bg-white border border-muted text-brand text-lg font-bold transition-all hover:bg-brand hover:text-white hover:border-brand disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-brand disabled:hover:border-muted active:scale-95"
        >
          −
        </button>

        <div
          aria-live="polite"
          className="w-8 text-center text-lg font-semibold text-foreground"
        >
          {quantity}
        </div>

        <button
          onClick={handleIncrement}
          disabled={quantity >= 99}
          aria-label="Increase quantity"
          className="w-8 h-8 rounded-md bg-white border border-muted text-brand text-lg font-bold transition-all hover:bg-brand hover:text-white hover:border-brand disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-brand disabled:hover:border-muted active:scale-95"
        >
          +
        </button>
      </div>
    </div>
  );
}