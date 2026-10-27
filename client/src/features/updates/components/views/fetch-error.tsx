import { WifiOffIcon } from 'lucide-react';

import { PairFooter, type ViewCtx, type ViewParts } from '../parts';

type Args = {
  ctx: ViewCtx;
  error: Error;
  isOffline: boolean;
  onClose: () => void;
  onRetry: () => void;
};

export const fetchErrorView = ({ ctx, error, isOffline, onClose, onRetry }: Args): ViewParts => {
  const { t } = ctx;
  const headline = isOffline ? t('update.offline') : t('update.checkFailed');
  const hint = isOffline ? t('update.offlineHint') : error.message;

  return {
    description: t('update.description'),
    body: (
      <div className="flex items-start gap-2 text-xs">
        {isOffline && <WifiOffIcon className="size-4 text-destructive shrink-0 mt-0.5" />}
        <div className="flex flex-col gap-1">
          <p className="text-destructive">{headline}</p>
          <p className="text-muted-foreground break-words">{hint}</p>
        </div>
      </div>
    ),
    footer: (
      <PairFooter
        ctx={ctx}
        onClose={onClose}
        primaryLabel={t('common.retry')}
        onPrimary={onRetry}
      />
    ),
  };
};
