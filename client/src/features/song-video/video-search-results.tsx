import { VideoIcon } from 'lucide-react';
import { useState } from 'react';

import type { VideoCandidate } from '@/bridge/song-video';
import { Button } from '@/shared/components/ui/button';
import type { Translate } from '@/shared/i18n/translator';
import { useI18n } from '@/shared/i18n/use-i18n';

function durationLabel(t: Translate, seconds: number | null): string {
  if (seconds === null) {
    return t('video.durationUnknown');
  }
  const duration = Math.round(seconds);
  return `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`;
}

function VideoThumbnail({ videoId }: { videoId: string }) {
  const [failedId, setFailedId] = useState<string | null>(null);
  return (
    <span
      className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-md bg-muted sm:w-40"
      aria-hidden="true"
    >
      <VideoIcon className="absolute inset-0 m-auto size-6 text-muted-foreground" />
      {failedId !== videoId && (
        <img
          src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`}
          alt=""
          width={320}
          height={180}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="relative size-full object-cover"
          onError={() => setFailedId(videoId)}
        />
      )}
    </span>
  );
}

export function VideoSearchResults({
  candidates,
  onSelect,
}: {
  candidates: readonly VideoCandidate[];
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      {candidates.map((candidate) => (
        <Button
          key={candidate.id}
          variant="outline"
          className="h-auto min-h-12 w-full justify-start gap-3 whitespace-normal py-2 text-left"
          onClick={() => onSelect(candidate.id)}
        >
          <VideoThumbnail videoId={candidate.id} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium break-words">{candidate.title}</span>
            <span className="block text-xs text-muted-foreground">
              {candidate.channel} · {durationLabel(t, candidate.duration_sec)} ·{' '}
              {t('video.downloadAndUse')}
            </span>
          </span>
        </Button>
      ))}
    </div>
  );
}
