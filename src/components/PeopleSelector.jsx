import { useState } from 'react';

export default function PeopleSelector({ initialCount = 2, onCountChange }) {
  const [count, setCount] = useState(initialCount);

  const handleIncrement = () => {
    const newCount = Math.min(count + 1, 20);
    setCount(newCount);
    onCountChange(newCount);
  };

  const handleDecrement = () => {
    const newCount = Math.max(count - 1, 2);
    setCount(newCount);
    onCountChange(newCount);
  };

  return (
    <div className="flex items-center justify-between px-4 py-4 bg-surface rounded-xl mb-3">
      <div className="text-base font-semibold text-foreground">
        Number of People
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={handleDecrement}
          disabled={count <= 2}
          aria-label="Decrease number of people"
          className="w-12 h-12 rounded-full bg-surface-raised border-2 border-border text-brand text-2xl font-bold transition-all hover:border-brand hover:bg-brand-muted disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:bg-surface-raised active:scale-95"
        >
          −
        </button>

        <div
          aria-live="polite"
          className="w-16 text-center text-4xl font-black text-foreground"
        >
          {count}
        </div>

        <button
          onClick={handleIncrement}
          disabled={count >= 20}
          aria-label="Increase number of people"
          className="w-12 h-12 rounded-full bg-surface-raised border-2 border-border text-brand text-2xl font-bold transition-all hover:border-brand hover:bg-brand-muted disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:bg-surface-raised active:scale-95"
        >
          +
        </button>
      </div>
    </div>
  );
}