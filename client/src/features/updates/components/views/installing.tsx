import { Spinner } from '@/shared/components/ui/spinner';

import type { ViewCtx, ViewParts } from '../parts';

export const installingView = ({ ctx }: { ctx: ViewCtx }): ViewParts => ({
  description: ctx.t('update.description'),
  body: (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <Spinner className="size-4" />
      <span>{ctx.t('update.installing')}</span>
    </p>
  ),
  footer: null,
});
