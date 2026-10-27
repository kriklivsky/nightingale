import { VideoIcon } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { useI18n } from '@/shared/i18n/use-i18n';

export function YoutubeVideoBadge() {
  const { t } = useI18n();

  return (
    <Badge
      variant="secondary"
      title={t('song.youtubeAttachedTitle')}
      aria-label={t('song.youtubeAttached')}
    >
      <VideoIcon aria-hidden="true" />
      YouTube
    </Badge>
  );
}
