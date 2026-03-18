import { useState } from 'react';
import { useMediaQuery } from '@/hooks/use-mobile';
import { BottomSheet, BottomSheetOption } from '@/components/BottomSheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from '@/components/ui/select';

/**
 * Responsive select wrapper that uses:
 * - BottomSheet on mobile (touch-optimized)
 * - Radix Select on desktop (web-native dropdown)
 * 
 * Usage:
 *   <SelectWrapper
 *     value={value}
 *     onValueChange={setValue}
 *     label="Pick one"
 *     placeholder="Select..."
 *   >
 *     <SelectItem value="a">Option A</SelectItem>
 *     <SelectItem value="b">Option B</SelectItem>
 *   </SelectWrapper>
 */
export function SelectWrapper({
  value,
  onValueChange,
  label,
  placeholder,
  children,
  disabled,
  className,
}) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [open, setOpen] = useState(false);

  // On mobile, use BottomSheet
  if (isMobile) {
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          disabled={disabled}
          className={`flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background text-left data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${className || ''}`}
        >
          <span className="line-clamp-1">
            {value
              ? Array.isArray(children)
                ? children.find(
                    (child) => child?.props?.value === value
                  )?.props?.children
                : children?.props?.children
              : placeholder}
          </span>
          <svg className="h-4 w-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>

        <BottomSheet open={open} onClose={() => setOpen(false)} title={label}>
          {Array.isArray(children)
            ? children.map((child) => (
                child?.props?.value && (
                  <BottomSheetOption
                    key={child.props.value}
                    label={child.props.children}
                    selected={value === child.props.value}
                    onSelect={() => {
                      onValueChange(child.props.value);
                      setOpen(false);
                    }}
                  />
                )
              ))
            : children?.props?.value && (
                <BottomSheetOption
                  label={children.props.children}
                  selected={value === children.props.value}
                  onSelect={() => {
                    onValueChange(children.props.value);
                    setOpen(false);
                  }}
                />
              )}
        </BottomSheet>
      </>
    );
  }

  // On desktop, use native Radix Select
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {children}
      </SelectContent>
    </Select>
  );
}

export { Select, SelectItem, SelectGroup, SelectLabel, SelectContent, SelectTrigger, SelectValue };