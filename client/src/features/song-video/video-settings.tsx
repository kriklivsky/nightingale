import { useState } from 'react';

import type { SongVideo } from '@/bridge/song-video';
import { Button } from '@/shared/components/ui/button';
import { useI18n } from '@/shared/i18n/use-i18n';
import type { Song } from '@/types/Song';

import { VideoPreview } from './video-preview';

type VideoSettingsProps = {
  song: Song;
  video: SongVideo;
  offset: number;
  adjust: (delta: number) => void;
  save: () => void;
  remove: () => void;
};

function RemoveVideo({ remove }: { remove: () => void }) {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState(false);
  if (!confirm) {
    return (
      <Button variant="outline" onClick={() => setConfirm(true)}>
        {t('video.remove')}
      </Button>
    );
  }
  return (
    <div className="space-y-2">
      <p>{t('video.removeConfirm')}</p>
      <div className="flex gap-2" data-video-nav-row>
        <Button variant="outline" onClick={() => setConfirm(false)}>
          {t('video.keep')}
        </Button>
        <Button variant="destructive" onClick={remove}>
          {t('video.removeClip')}
        </Button>
      </div>
    </div>
  );
}

export function VideoSettings({ song, video, offset, adjust, save, remove }: VideoSettingsProps) {
  const { t } = useI18n();

  return (
    <section className="space-y-3 border-t pt-3" aria-label={t('video.sync')}>
      <p className="text-sm font-medium">{video.title}</p>
      <p className="text-sm text-muted-foreground">
        {video.audio_matched ? t('video.matched') : t('video.manualTiming')}
      </p>
      <VideoPreview key={video.path} song={song} video={video} offsetSec={offset} />
      <p className="text-sm">
        {t('video.offset')}{' '}
        <output>
          {t('video.seconds', { value: `${offset >= 0 ? '+' : ''}${offset.toFixed(2)}` })}
        </output>
        . {t('video.offsetHint')}
      </p>
      <div className="flex flex-wrap gap-2" data-video-nav-row>
        {[-1, -0.1, 0.1, 1].map((delta) => (
          <Button key={delta} variant="outline" onClick={() => adjust(delta)}>
            {t('video.seconds', { value: `${delta > 0 ? '+' : ''}${delta}` })}
          </Button>
        ))}
        <Button onClick={save}>{t('video.saveOffset')}</Button>
      </div>
      <RemoveVideo remove={remove} />
    </section>
  );
}
