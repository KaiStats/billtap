import { useState } from 'react';
import { Check } from 'lucide-react';

export default function SplitItemSelector({
  participants,
  itemName,
  itemPrice,
  onSplitConfirm
}) {
  const [selectedPeople, setSelectedPeople] = useState([]);

  const togglePerson = (personId) => {
    setSelectedPeople(prev => {
      if (prev.includes(personId)) {
        return prev.filter(id => id !== personId);
      } else {
        return [...prev, personId];
      }
    });
  };

  const handleConfirm = () => {
    onSplitConfirm(selectedPeople);
  };

  const pricePerPerson =
    selectedPeople.length > 0 ? itemPrice / selectedPeople.length : 0;

  return (
    <fieldset className="p-6 bg-surface-raised rounded-3xl rounded-b-none max-h-[80vh] overflow-y-auto">
      <div className="mb-5">
        <legend className="text-2xl font-black text-foreground mb-2">
          Split {itemName}
        </legend>
        <div className="text-sm text-muted-foreground">
          ${itemPrice.toFixed(2)} - Select who's sharing this
        </div>
      </div>

      <div className="flex flex-col gap-2 mb-5" role="group" aria-label={`Select participants for ${itemName}`}>
        {participants.map(person => (
          <button
            key={person.id}
            onClick={() => togglePerson(person.id)}
            aria-label={`${selectedPeople.includes(person.id) ? 'Deselect' : 'Select'} ${person.name}`}
            aria-pressed={selectedPeople.includes(person.id)}
            className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all active:scale-[0.98] min-h-[64px] ${
              selectedPeople.includes(person.id)
                ? 'border-brand bg-brand-muted'
                : 'border-border bg-surface hover:border-muted'
            }`}
          >
            <div
              className={`w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${
                selectedPeople.includes(person.id)
                  ? 'border-brand bg-brand'
                  : 'border-muted'
              }`}
            >
              {selectedPeople.includes(person.id) && (
                <Check className="w-4 h-4 text-white" />
              )}
            </div>

            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand to-purple-700 text-white flex items-center justify-center font-bold text-base flex-shrink-0">
              {person.name.charAt(0).toUpperCase()}
            </div>

            <div className="flex-1 text-left text-base font-semibold text-foreground">
              {person.name}
            </div>
          </button>
        ))}
      </div>

      {selectedPeople.length > 0 && (
        <div className="bg-brand-muted rounded-xl p-4 mb-4 text-center">
          <div className="text-sm text-muted-foreground mb-1">
            Each person pays
          </div>
          <div className="text-3xl font-black text-brand">
            ${pricePerPerson.toFixed(2)}
          </div>
        </div>
      )}

      <button
        onClick={handleConfirm}
        disabled={selectedPeople.length === 0}
        aria-label={`Split ${itemName} between ${selectedPeople.length} ${selectedPeople.length === 1 ? 'person' : 'people'}`}
        className="w-full px-4 py-4 bg-brand text-brand-foreground rounded-xl font-bold text-lg transition-all hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none active:scale-95 min-h-14"
      >
        {selectedPeople.length === 0
          ? 'Select People to Split'
          : `Split Between ${selectedPeople.length} ${
              selectedPeople.length === 1 ? 'Person' : 'People'
            }`}
      </button>
      </fieldset>
      );
      }