import type { Update } from '@tauri-apps/plugin-updater';
import { DownloadIcon } from 'lucide-react';

import { Separator } from '@/shared/components/ui/separator';
import type { Locale } from '@/shared/i18n/translator';

import { CURRENT_VERSION, PairFooter, type ViewCtx, type ViewParts } from '../parts';
import { ReleaseNotes } from '../release-notes';

type Args = {
  ctx: ViewCtx;
  update: Update;
  onClose: () => void;
  onInstall: () => void;
};

const formatPubDate = (date: string | undefined, locale: Locale): string | null => {
  if (typeof date !== 'string' || date === '') {
    return null;
  }

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

export const availableView = ({ ctx, update, onClose, onInstall }: Args): ViewParts => {
  const { t } = ctx;
  const pubDate = formatPubDate(update.date, ctx.locale);
  const notes = update.body?.trim();

  return {
    description: t('update.availableDescription'),
    body: (
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <DownloadIcon className="size-4 text-primary shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium">
              {t('update.versionAvailable', { version: update.version })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('update.currentVersion', { version: CURRENT_VERSION })}
              {typeof pubDate === 'string' && pubDate !== ''
                ? ` · ${t('update.released', { date: pubDate })}`
                : ''}
            </p>
          </div>
        </div>
        {typeof notes === 'string' && notes !== '' && (
          <>
            <Separator />
            <div className="flex flex-col gap-1">
              <h4 className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
                {t('update.releaseNotes')}
              </h4>
              <ReleaseNotes body={notes} />
            </div>
          </>
        )}
      </div>
    ),
    footer: (
      <PairFooter
        ctx={ctx}
        closeLabel={t('update.later')}
        onClose={onClose}
        primaryLabel={t('update.install')}
        onPrimary={onInstall}
      />
    ),
  };
};
