import { useState } from 'react';

import type { SongVideo } from '@/bridge/song-video';
import { Button } from '@/shared/components/ui/button';
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
  const [confirm, setConfirm] = useState(false);
  if (!confirm) {
    return (
      <Button variant="outline" onClick={() => setConfirm(true)}>
        Remove video…
      </Button>
    );
  }
  return (
    <div className="space-y-2">
      <p>Remove the downloaded clip? Your original song files will stay.</p>
      <div className="flex gap-2" data-video-nav-row>
        <Button variant="outline" onClick={() => setConfirm(false)}>
          Keep video
        </Button>
        <Button variant="destructive" onClick={remove}>
          Remove downloaded clip
        </Button>
      </div>
    </div>
  );
}

export function VideoSettings({ song, video, offset, adjust, save, remove }: VideoSettingsProps) {
  return (
    <section className="space-y-3 border-t pt-3" aria-label="Video synchronization">
      <p className="text-sm font-medium">{video.title}</p>
      <p className="text-sm text-muted-foreground">
        {video.audio_matched
          ? 'Audio match found. Check the preview before singing.'
          : 'Manual timing: automatic audio matching was not confirmed or the offset was adjusted.'}
      </p>
      <VideoPreview key={video.path} song={song} video={video} offsetSec={offset} />
      <p className="text-sm">
        Video offset:{' '}
        <output>
          {offset >= 0 ? '+' : ''}
          {offset.toFixed(2)} s
        </output>
        . Positive values skip the clip’s intro; negative values delay the clip.
      </p>
      <div className="flex flex-wrap gap-2" data-video-nav-row>
        {[-1, -0.1, 0.1, 1].map((delta) => (
          <Button key={delta} variant="outline" onClick={() => adjust(delta)}>
            {delta > 0 ? '+' : ''}
            {delta} s
          </Button>
        ))}
        <Button onClick={save}>Save offset</Button>
      </div>
      <RemoveVideo remove={remove} />
    </section>
  );
}
