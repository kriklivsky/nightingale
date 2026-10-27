import prettyBytes from 'pretty-bytes';

import { Progress } from '@/shared/components/ui/progress';

import type { ViewCtx, ViewParts } from '../parts';

type Args = {
  ctx: ViewCtx;
  downloaded: number;
  contentLength: number | null;
  version: string;
};

export const downloadingView = ({ ctx, downloaded, contentLength, version }: Args): ViewParts => {
  const { t } = ctx;
  const percent =
    typeof contentLength === 'number' && contentLength !== 0 && contentLength > 0
      ? Math.min(100, Math.floor((downloaded / contentLength) * 100))
      : null;

  const sizeLabel =
    typeof contentLength === 'number' && contentLength !== 0
      ? `${t('update.sizeOf', {
          downloaded: prettyBytes(downloaded, { locale: ctx.locale }),
          total: prettyBytes(contentLength, { locale: ctx.locale }),
        })}${percent !== null ? ` (${percent}%)` : ''}`
      : prettyBytes(downloaded, { locale: ctx.locale });

  return {
    description: t('update.description'),
    body: (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">{t('update.downloading', { version })}</p>
        <Progress value={percent ?? 0} max={100} />
        <p className="text-xs text-muted-foreground">{sizeLabel}</p>
      </div>
    ),
    footer: null,
  };
};
