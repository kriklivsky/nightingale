import { useId, useState } from 'react';

import { Slider } from '@/shared/components/ui/slider';

type VolumeSliderProps = {
  label: string;
  value: number;
  max?: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
};

type Pending = { value: number; reported: number };

export function VolumeSlider({ label, value, max = 1, disabled, onCommit }: VolumeSliderProps) {
  const labelId = useId();
  const [dragging, setDragging] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const confirmed = pending !== null && pending.reported === value ? pending.value : value;
  const shown = dragging ?? confirmed;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between text-sm">
        <span id={labelId}>{label}</span>
        <span className="tabular-nums text-muted-foreground">{Math.round(shown * 100)}%</span>
      </div>
      <Slider
        aria-labelledby={labelId}
        className="py-2"
        min={0}
        max={max}
        step={0.01}
        value={[shown]}
        disabled={disabled}
        onValueChange={([next]) => setDragging(next)}
        onValueCommit={([next]) => {
          setDragging(null);
          setPending({ value: next, reported: value });
          onCommit(next);
        }}
      />
    </div>
  );
}
