import { TrophyIcon, VideoIcon } from 'lucide-react';
import { Fragment } from 'react';
import { toast } from 'sonner';

import { useAnalysis } from '@/features/library/hooks/use-analysis';
import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useProfiles } from '@/features/profiles/queries/use-profiles';
import { Separator } from '@/shared/components/ui/separator';
import { useI18n } from '@/shared/i18n/use-i18n';
import type { Song } from '@/types/Song';

import type { SongStatusInfo } from '../song/song-status';
import { ActionItem } from './action-item';
import { buildActionGroups } from './song-actions';

type ActionsSectionProps = {
  song: Song;
  status: SongStatusInfo;
  analysisBusy: boolean;
  supportsAnalysisActions: boolean;
};

const run =
  (
    message: string,
    action: () => void | boolean | undefined | Promise<void | boolean | undefined>,
    onFalse?: string,
  ) =>
  async (): Promise<void> => {
    const result = await action();
    toast.info(
      result === false && typeof onFalse === 'string' && onFalse !== '' ? onFalse : message,
    );
  };

export const ActionsSection = ({
  song,
  status,
  analysisBusy,
  supportsAnalysisActions,
}: ActionsSectionProps) => {
  const { t } = useI18n();
  const { setMode } = useDialog();
  const analysis = useAnalysis();
  const { data: profiles } = useProfiles();
  const hasScores = profiles?.scores.some((score) => score.song_hash === song.file_hash) ?? false;

  const groups = buildActionGroups({
    song,
    status,
    analysisBusy,
    supportsAnalysisActions,
    analysis,
    onEditLyrics: () => setMode({ mode: 'edit-lyrics', song }),
    onChangeLanguage: () => setMode({ mode: 'language', song }),
    t,
    run,
  });

  if (hasScores) {
    groups.unshift([
      {
        icon: TrophyIcon,
        title: t('songAction.leaderboard'),
        description: t('songAction.leaderboardDescription'),
        onClick: () => setMode({ mode: 'song-leaderboard', song }),
      },
    ]);
  }

  if (song.origin.kind === 'local_file') {
    groups.unshift([
      {
        icon: VideoIcon,
        title: t('songAction.youtubeVideo'),
        description: t('songAction.youtubeVideoDescription'),
        onClick: () => setMode({ mode: 'song-video', song }),
      },
    ]);
  }

  return (
    <section className="px-2 py-4" aria-labelledby="song-actions-heading">
      <h3 id="song-actions-heading" className="mb-2 px-2 text-xs font-semibold">
        {t('songAction.heading')}
      </h3>
      <div className="flex flex-col gap-1">
        {groups.map((group, groupIndex) => (
          <Fragment key={group.map((item) => item.title).join('|')}>
            {groupIndex > 0 ? <Separator className="my-1" /> : null}
            {group.map((item) => (
              <ActionItem key={item.title} {...item} />
            ))}
          </Fragment>
        ))}
      </div>
    </section>
  );
};
