import { Button } from '@/shared/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import type { Translate } from '@/shared/i18n/translator';
import { useI18n } from '@/shared/i18n/use-i18n';
import type { CustomBackground } from '@/types/CustomBackground';

function sourceLabel(t: Translate, background: CustomBackground): string {
  return background.source.kind === 'url' ? t('background.link') : t('background.uploadedFile');
}

function typeLabel(t: Translate, background: CustomBackground): string {
  if (background.background_type === 'shader') {
    return t('background.type.shader');
  }
  return background.background_type === 'video'
    ? t('background.type.video')
    : t('background.type.image');
}

export function BackgroundTable({
  backgrounds,
  busy,
  pendingRemoval,
  getFocusClassName,
  onRemove,
}: {
  backgrounds: readonly CustomBackground[];
  busy: boolean;
  pendingRemoval: string | null;
  getFocusClassName: (index: number) => string | undefined;
  onRemove: (id: string) => void;
}) {
  const { t } = useI18n();
  if (backgrounds.length === 0) {
    return (
      <div className="flex min-h-32 items-center justify-center rounded-lg border">
        <p className="text-sm text-muted-foreground">{t('background.none')}</p>
      </div>
    );
  }

  return (
    <div className="min-h-0 overflow-y-auto rounded-lg border">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead>{t('background.name')}</TableHead>
            <TableHead>{t('background.typeHeader')}</TableHead>
            <TableHead>{t('background.source')}</TableHead>
            <TableHead className="text-right">{t('background.action')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {backgrounds.map((background, index) => (
            <TableRow key={background.id}>
              <TableCell className="max-w-64 truncate font-medium">{background.name}</TableCell>
              <TableCell>{typeLabel(t, background)}</TableCell>
              <TableCell>{sourceLabel(t, background)}</TableCell>
              <TableCell className="text-right">
                <Button
                  variant={pendingRemoval === background.id ? 'destructive' : 'outline'}
                  size="sm"
                  disabled={busy}
                  className={getFocusClassName(index)}
                  onClick={() => onRemove(background.id)}
                >
                  {pendingRemoval === background.id
                    ? t('background.confirmRemove')
                    : t('background.remove')}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
