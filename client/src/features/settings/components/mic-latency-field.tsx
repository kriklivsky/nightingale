import { useState } from 'react';
import { toast } from 'sonner';

import { measureMicLatencySec } from '@/features/microphone/lib/latency-test';
import { Button } from '@/shared/components/ui/button';
import { Field } from '@/shared/components/ui/field';
import { Label } from '@/shared/components/ui/label';
import { Slider } from '@/shared/components/ui/slider';
import { useI18n } from '@/shared/i18n/use-i18n';
import { cn } from '@/shared/utils/cn';

import { Hint } from './settings-controls';

type MicLatencyFieldProps = {
  selectedMicId: string | null;
  latencySec: number;
  sliderClassName?: string;
  buttonClassName?: string;
  disabled?: boolean;
  onMeasuringChange?: (measuring: boolean) => void;
  onLatencyChange: (latencySec: number) => void;
};

export function MicLatencyField({
  selectedMicId,
  latencySec,
  sliderClassName,
  buttonClassName,
  disabled = false,
  onMeasuringChange,
  onLatencyChange,
}: MicLatencyFieldProps) {
  const { t } = useI18n();
  const [measuring, setMeasuring] = useState(false);
  const latencyMs = Math.round(latencySec * 1000);

  const runTest = async () => {
    if (measuring) {
      return;
    }

    setMeasuring(true);
    onMeasuringChange?.(true);
    try {
      const measured = await measureMicLatencySec(selectedMicId);
      onLatencyChange(measured);
      toast.success(t('settings.latency.measured', { value: Math.round(measured * 1000) }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(t('settings.latency.failed', { detail: message }));
    } finally {
      setMeasuring(false);
      onMeasuringChange?.(false);
    }
  };

  return (
    <Field>
      <Label>{t('settings.latency.label')}</Label>
      <Hint>{t('settings.latency.hint', { value: latencyMs })}</Hint>
      <Slider
        min={0}
        max={500}
        step={5}
        value={[latencyMs]}
        onValueChange={([ms]) => onLatencyChange(ms / 1000)}
        className={sliderClassName}
      />
      <Button
        variant="outline"
        onClick={() => void runTest()}
        disabled={disabled || measuring}
        className={cn('w-fit', buttonClassName)}
      >
        {measuring ? t('settings.latency.measuring') : t('settings.latency.measure')}
      </Button>
      <Hint>{t('settings.latency.measureHint')}</Hint>
    </Field>
  );
}
