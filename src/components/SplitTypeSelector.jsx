import { useState } from 'react';

export default function SplitTypeSelector({ onTypeChange }) {
  const [splitType, setSplitType] = useState('itemized');

  const options = [
    {
      value: 'itemized',
      icon: '👆',
      title: 'Itemized',
      subtitle: 'Tap what you ordered'
    },
    {
      value: 'even',
      icon: '➗',
      title: 'Split Evenly',
      subtitle: 'Divide by number of people'
    }
  ];

  const handleSelect = (type) => {
    setSplitType(type);
    onTypeChange(type);
  };

  return (
    <fieldset className="py-4">
      <legend className="text-base font-semibold text-foreground mb-3">
        How do you want to split?
      </legend>

      <div className="grid grid-cols-2 gap-3" role="group" aria-labelledby="split-type-legend">
        {options.map(option => (
          <button
            key={option.value}
            onClick={() => handleSelect(option.value)}
            aria-label={`${option.title}: ${option.subtitle}`}
            aria-pressed={splitType === option.value}
            className={`min-h-[120px] rounded-xl border-2 p-4 flex flex-col items-center justify-center gap-2 transition-all active:scale-95 ${
              splitType === option.value
                ? 'border-brand bg-brand-muted'
                : 'border-border bg-surface-raised hover:border-muted-foreground/30'
            }`}
          >
            <div className="text-4xl" aria-hidden="true">
              {option.icon}
            </div>
            <div className={`text-base font-semibold ${
              splitType === option.value ? 'text-brand' : 'text-foreground'
            }`}>
              {option.title}
            </div>
            <div className="text-xs text-muted-foreground">
              {option.subtitle}
            </div>
          </button>
        ))}
      </div>
    </fieldset>
  );
}