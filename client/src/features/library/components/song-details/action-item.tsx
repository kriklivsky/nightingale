import type { LucideIcon } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/utils/cn';

export type ActionItemProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  destructive?: boolean;
};

export const ActionItem = ({
  icon: Icon,
  title,
  description,
  onClick,
  disabled,
  destructive,
}: ActionItemProps) => (
  <Button
    type="button"
    variant={destructive === true ? 'destructive' : 'ghost'}
    size="lg"
    className={cn(
      'h-auto min-h-14 w-full items-start justify-start gap-3 px-3 py-2 text-left whitespace-normal',
      // Match the keyboard-focus treatment (ring-2 ring-primary + z-10) on
      // hover so pointer and gamepad/keyboard highlighting look identical.
      'hover:z-10 hover:ring-2 hover:ring-primary',
      destructive === true
        ? 'hover:bg-destructive/10 dark:hover:bg-destructive/20'
        : 'hover:bg-transparent dark:hover:bg-transparent',
    )}
    disabled={disabled}
    onClick={() => void onClick()}
  >
    <Icon className="mt-0.5 size-5" />
    <span className="min-w-0">
      <span className="block text-sm font-medium leading-snug">{title}</span>
      <span
        className={
          destructive === true
            ? 'mt-0.5 block text-xs leading-snug text-destructive/80'
            : 'mt-0.5 block text-xs leading-snug text-muted-foreground'
        }
      >
        {description}
      </span>
    </span>
  </Button>
);
