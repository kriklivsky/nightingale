import { useMemo, useState } from 'react';

import { Button } from '@/shared/components/ui/button';
import { Field, FieldDescription } from '@/shared/components/ui/field';
import { Label } from '@/shared/components/ui/label';
import { useConfig } from '@/shared/config/use-config';
import { useConfigMutation } from '@/shared/config/use-config-mutation';
import { useI18n } from '@/shared/i18n/use-i18n';

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
  const { t } = useI18n();
  const { data: config } = useConfig();
  const { mutate } = useConfigMutation();
  const [open, setOpen] = useState(false);
  const options = useMemo(
    () => backgroundOptions(t, config?.custom_backgrounds ?? []),
    [config?.custom_backgrounds, t],
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
        <Label htmlFor="default-background">{t('background.default')}</Label>
        <FieldDescription>{t('background.defaultHint')}</FieldDescription>
        <div className="flex flex-col gap-2 sm:flex-row">
          <SettingsSelect
            id="default-background"
            label={t('background.default')}
            placeholder={t('background.select')}
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
            {t('background.manage')}
          </Button>
        </div>
      </Field>

      <BackgroundManagerDialog open={open} config={config} onOpenChange={updateOpen} />
    </>
  );
}
