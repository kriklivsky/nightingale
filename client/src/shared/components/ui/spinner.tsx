import { Loader2Icon } from 'lucide-react';

import { useI18n } from '@/shared/i18n/use-i18n';
import { cn } from '@/shared/utils/cn';

function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  const { t } = useI18n();

  return (
    <output aria-label={t('common.loading')}>
      <Loader2Icon
        aria-hidden="true"
        className={cn(
          'size-4 animate-spin will-change-transform motion-reduce:animate-none',
          className,
        )}
        {...props}
      />
    </output>
  );
}

export { Spinner };
