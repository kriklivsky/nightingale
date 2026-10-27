import { Spinner } from '@/shared/components/ui/spinner';

import { SoloFooter, type ViewCtx, type ViewParts } from '../parts';

type Args = {
  ctx: ViewCtx;
  onClose: () => void;
};

export const checkingView = ({ ctx, onClose }: Args): ViewParts => ({
  description: ctx.t('update.description'),
  body: (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <Spinner className="size-4" />
      <span>{ctx.t('update.checking')}</span>
    </p>
  ),
  footer: <SoloFooter ctx={ctx} label={ctx.t('common.close')} onClick={onClose} />,
});
