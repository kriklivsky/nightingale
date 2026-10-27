import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/shared/components/ui/button';
import { DialogFooter } from '@/shared/components/ui/dialog';
import type { Locale, Translate } from '@/shared/i18n/translator';
import { cn } from '@/shared/utils/cn';

import { version as currentVersion } from '../../../../package.json';

export const CURRENT_VERSION = currentVersion;
export const RELEASES_URL = 'https://github.com/rzru/nightingale/releases/latest';
export const SELF_HOSTED_DOCS_URL = 'https://nightingale.cafe/docs/self-hosted.html#updating';

const RING = 'ring-2 ring-primary';
const NO_FOCUS_RING = 'focus-visible:ring-0 focus-visible:border-transparent';

export type ViewCtx = {
  open: boolean;
  focusedIndex: number;
  t: Translate;
  locale: Locale;
};

export type ViewParts = {
  description: string;
  body: ReactNode;
  footer: ReactNode | null;
};

export const ringFor = (ctx: ViewCtx, idx: number) =>
  cn(NO_FOCUS_RING, ctx.open && ctx.focusedIndex === idx && RING);

type SoloFooterProps = {
  ctx: ViewCtx;
  label: string;
  onClick: () => void;
};

export const SoloFooter = ({ ctx, label, onClick }: SoloFooterProps) => (
  <DialogFooter>
    <Button onClick={onClick} className={ringFor(ctx, 0)}>
      {label}
    </Button>
  </DialogFooter>
);

type PairFooterProps = {
  ctx: ViewCtx;
  closeLabel?: string;
  onClose: () => void;
  primaryLabel: string;
  primaryIcon?: LucideIcon;
  onPrimary: () => void;
};

export const PairFooter = ({
  ctx,
  closeLabel,
  onClose,
  primaryLabel,
  primaryIcon: Icon,
  onPrimary,
}: PairFooterProps) => (
  <DialogFooter>
    <Button variant="outline" onClick={onClose} className={ringFor(ctx, 0)}>
      {closeLabel ?? ctx.t('common.close')}
    </Button>
    <Button onClick={onPrimary} className={ringFor(ctx, 1)}>
      {Icon && <Icon />}
      {primaryLabel}
    </Button>
  </DialogFooter>
);

export const InfoLine = ({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) => (
  <p className="flex items-start gap-2 text-xs text-muted-foreground">
    <Icon className="size-4 shrink-0 mt-0.5" />
    <span>{children}</span>
  </p>
);
