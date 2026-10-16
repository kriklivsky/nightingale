import { useMemo, useState } from 'react';

import { Button } from '@/shared/components/ui/button';
import { Field, FieldDescription } from '@/shared/components/ui/field';
import { Label } from '@/shared/components/ui/label';
import { useConfig } from '@/shared/config/use-config';
import { useConfigMutation } from '@/shared/config/use-config-mutation';

import { backgroundOptions, initialBackgroundSelection } from '../lib/background-options';
import { BackgroundManagerDialog } from './background-manager-dialog';
import { SettingsSelect } from './settings-controls';

export function BackgroundSettings({
  selectClassName,
  manageClassName,
  onDialogOpenChange,
}: {
  selectClassName?: string;
  manageClassName?: string;
  onDialogOpenChange?: (open: boolean) => void;
}) {
  const { data: config } = useConfig();
  const { mutate } = useConfigMutation();
  const [open, setOpen] = useState(false);
  const options = useMemo(
    () => backgroundOptions(config?.custom_backgrounds ?? []),
    [config?.custom_backgrounds],
  );
  const selected =
    config === undefined ? options[0].value : initialBackgroundSelection(config, options);
  const updateOpen = (next: boolean) => {
    setOpen(next);
    onDialogOpenChange?.(next);
  };

  return (
    <>
      <Field>
        <Label htmlFor="default-background">Default background</Label>
        <FieldDescription>
          Used when playback starts; press T during playback to cycle
        </FieldDescription>
        <div className="flex flex-col gap-2 sm:flex-row">
          <SettingsSelect
            id="default-background"
            label="Default background"
            placeholder="Select background"
            value={selected}
            options={options}
            triggerClassName={selectClassName}
            onValueChange={(value) => {
              const option = options.find((candidate) => candidate.value === value);
              if (option !== undefined) {
                mutate({ last_background: option.selection });
              }
            }}
          />
          <Button variant="outline" className={manageClassName} onClick={() => updateOpen(true)}>
            Manage
          </Button>
        </div>
      </Field>

      <BackgroundManagerDialog open={open} config={config} onOpenChange={updateOpen} />
    </>
  );
}
