import { PairFooter, type ViewCtx, type ViewParts } from '../parts';

type Args = {
  ctx: ViewCtx;
  message: string;
  onClose: () => void;
  onRetry: () => void;
};

export const installErrorView = ({ ctx, message, onClose, onRetry }: Args): ViewParts => ({
  description: ctx.t('update.description'),
  body: (
    <div className="flex flex-col gap-2 text-xs">
      <p className="text-destructive">{ctx.t('update.installFailed')}</p>
      <p className="text-muted-foreground break-words">{message}</p>
    </div>
  ),
  footer: (
    <PairFooter
      ctx={ctx}
      onClose={onClose}
      primaryLabel={ctx.t('update.retryInstall')}
      onPrimary={onRetry}
    />
  ),
});
