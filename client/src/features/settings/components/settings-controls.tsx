import type { ReactNode } from 'react';

import { FieldDescription } from '@/shared/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { useI18n } from '@/shared/i18n/use-i18n';
import { cn } from '@/shared/utils/cn';

import type { SettingsOption } from './constants';

type SettingsSelectProps = {
  id?: string;
  label: string;
  placeholder: string;
  value: string;
  options: SettingsOption[];
  disabled?: boolean;
  triggerClassName?: string;
  onValueChange: (value: string) => void;
};

export function SettingsSelect({
  id,
  label,
  placeholder,
  value,
  options,
  disabled = false,
  triggerClassName,
  onValueChange,
}: SettingsSelectProps) {
  return (
    <Select disabled={disabled} onValueChange={onValueChange} value={value}>
      <SelectTrigger id={id} className={cn('min-h-11 w-full text-base', triggerClassName)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" className="w-[var(--radix-select-trigger-width)]">
        <SelectGroup>
          <SelectLabel>{label}</SelectLabel>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} description={option.description}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function PageHeader() {
  const { t } = useI18n();

  return (
    <div className="space-y-1">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t('menu.settings')}</h1>
      <p className="text-sm text-muted-foreground">{t('settings.description')}</p>
    </div>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <FieldDescription>{children}</FieldDescription>;
}
