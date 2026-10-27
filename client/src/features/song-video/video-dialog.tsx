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
import { useI18n } from '@/shared/i18n/use-i18n';
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
  const { t } = useI18n();
  if (workspace.operation.isLoading) {
    return (
      <output>
        {workspace.operation.variables?.action === 'download'
          ? t('video.downloading')
          : t('video.saving')}
      </output>
    );
  }
  const empty = hasNoSearchResults(workspace);
  return (
    <>
      <div className="flex flex-wrap gap-2" data-video-nav-row>
        <Button variant="outline" onClick={() => workspace.runSearch(false)}>
          {t('video.searchArtistTitle')}
        </Button>
        <Button variant="outline" onClick={() => workspace.runSearch(true)}>
          {t('video.searchTitle')}
        </Button>
      </div>
      {workspace.candidates.isFetching && <output>{t('video.searching')}</output>}
      {empty && <p>{t('video.noResults')}</p>}
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
  const { t } = useI18n();
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
          <DialogTitle className="text-xl">{t('video.title', { title: song.title })}</DialogTitle>
          <DialogDescription>{t('video.description')}</DialogDescription>
        </DialogHeader>
        {videoTokenRequired && (
          <div className="space-y-1">
            <label htmlFor={tokenId} className="text-sm">
              {t('video.token')}
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
        <p className="text-sm text-muted-foreground">{t('video.footnote')}</p>
        <Button variant="outline" onClick={close}>
          {t('common.close')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
