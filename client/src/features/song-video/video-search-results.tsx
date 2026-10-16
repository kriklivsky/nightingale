import type { VideoCandidate } from '@/bridge/song-video';
import { Button } from '@/shared/components/ui/button';

function durationLabel(seconds: number | null): string {
  if (seconds === null) {
    return 'Duration unknown';
  }
  const duration = Math.round(seconds);
  return `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`;
}

export function VideoSearchResults({
  candidates,
  onSelect,
}: {
  candidates: readonly VideoCandidate[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      {candidates.map((candidate) => (
        <Button
          key={candidate.id}
          variant="outline"
          className="h-auto min-h-12 w-full justify-start whitespace-normal py-2 text-left"
          onClick={() => onSelect(candidate.id)}
        >
          <span>
            <span className="block text-sm font-medium">{candidate.title}</span>
            <span className="block text-xs text-muted-foreground">
              {candidate.channel} · {durationLabel(candidate.duration_sec)} · Download & use
            </span>
          </span>
        </Button>
      ))}
    </div>
  );
}
