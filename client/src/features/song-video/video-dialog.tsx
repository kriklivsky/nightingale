import { useId } from 'react';

import { videoTokenRequired } from '@/bridge/song-video';
import { useDialog } from '@/features/menu/hooks/use-dialog';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import type { Song } from '@/types/Song';

import { useVideoDialogNav } from './use-video-dialog-nav';
import { useVideoWorkspace } from './use-video-workspace';
import { VideoSearchResults } from './video-search-results';
import { VideoSettings } from './video-settings';

function hasNoSearchResults(workspace: ReturnType<typeof useVideoWorkspace>): boolean {
  return (
    workspace.searched &&
    !workspace.candidates.isFetching &&
    workspace.candidates.data?.length === 0
  );
}

function VideoWorkspace({
  song,
  workspace,
}: {
  song: Song;
  workspace: ReturnType<typeof useVideoWorkspace>;
}) {
  if (workspace.operation.isLoading) {
    return (
      <output>
        {workspace.operation.variables?.action === 'download'
          ? 'Downloading video and matching its audio… This can take several minutes.'
          : 'Saving video settings…'}
      </output>
    );
  }
  const empty = hasNoSearchResults(workspace);
  return (
    <>
      <div className="flex flex-wrap gap-2" data-video-nav-row>
        <Button variant="outline" onClick={() => workspace.runSearch(false)}>
          Search artist + title
        </Button>
        <Button variant="outline" onClick={() => workspace.runSearch(true)}>
          Search title only
        </Button>
      </div>
      {workspace.candidates.isFetching && <output>Searching YouTube…</output>}
      {empty && <p>No videos found. Try searching by title only.</p>}
      <VideoSearchResults
        candidates={workspace.candidates.data ?? []}
        onSelect={(id) => workspace.operation.mutate({ action: 'download', id })}
      />
      {workspace.video.data && (
        <VideoSettings
          song={song}
          video={workspace.video.data}
          offset={workspace.offset}
          adjust={workspace.adjust}
          save={() => workspace.operation.mutate({ action: 'offset', value: workspace.offset })}
          remove={() => workspace.operation.mutate({ action: 'remove' })}
        />
      )}
    </>
  );
}

export function SongVideoDialog({ song }: { song: Song }) {
  const { close } = useDialog();
  const workspace = useVideoWorkspace(song.file_hash);
  const tokenId = useId();
  const bind = useVideoDialogNav(close);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
    >
      <DialogContent
        ref={bind}
        showCloseButton={false}
        className="max-h-[90dvh] overflow-y-auto text-base sm:max-w-3xl [&_[data-video-focused=true]]:ring-2 [&_[data-video-focused=true]]:ring-primary"
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-xl">Video · {song.title}</DialogTitle>
          <DialogDescription>
            Find a clip, match it to your local song, and fine-tune its timing. Karaoke keeps its
            local audio; the clip is muted.
          </DialogDescription>
        </DialogHeader>
        {videoTokenRequired && (
          <div className="space-y-1">
            <label htmlFor={tokenId} className="text-sm">
              Server YouTube access token
            </label>
            <Input
              id={tokenId}
              type="password"
              autoComplete="off"
              value={workspace.token}
              maxLength={256}
              onChange={(event) => workspace.setToken(event.target.value)}
              disabled={workspace.operation.isLoading}
            />
          </div>
        )}
        <VideoWorkspace song={song} workspace={workspace} />
        {workspace.error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {workspace.error}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          ↑↓ rows · ←→ buttons · OK select · Back close. Downloads: H.264, up to 1080p/512 MiB.
          Download only videos you are permitted to use. Clearing the video cache removes these
          clips.
        </p>
        <Button variant="outline" onClick={close}>
          Close
        </Button>
      </DialogContent>
    </Dialog>
  );
}
