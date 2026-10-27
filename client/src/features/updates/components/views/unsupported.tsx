import { ExternalLinkIcon, InfoIcon, ServerIcon } from 'lucide-react';

import type { UnsupportedChannel } from '@/features/updates/queries/use-update';

import { CURRENT_VERSION, InfoLine, PairFooter, type ViewCtx, type ViewParts } from '../parts';

type Args = {
  ctx: ViewCtx;
  channel: UnsupportedChannel;
  onClose: () => void;
  onOpenReleases: () => void;
  onOpenSelfHostedDocs: () => void;
};

/**
 * Two distinct "manual update" stories share the same dialog layout:
 *
 *  - Tauri Linux build: no bundler-supported auto-update, user downloads
 *    the next release tarball from GitHub.
 *  - Self-hosted web build: nightingale runs as a service on a host the
 *    user controls; updating means SSHing in and re-running the install
 *    script (which already preserves data / config / library).
 *
 * The desktop-Linux copy is byte-identical to the previous version of this
 * view so behaviour for that build doesn't regress.
 */
export const unsupportedView = ({
  ctx,
  channel,
  onClose,
  onOpenReleases,
  onOpenSelfHostedDocs,
}: Args): ViewParts => {
  if (channel === 'self-hosted-web') {
    return selfHostedWebView({ ctx, onClose, onOpenSelfHostedDocs });
  }
  return linuxTauriView({ ctx, onClose, onOpenReleases });
};

type LinuxArgs = {
  ctx: ViewCtx;
  onClose: () => void;
  onOpenReleases: () => void;
};

const linuxTauriView = ({ ctx, onClose, onOpenReleases }: LinuxArgs): ViewParts => ({
  description: ctx.t('update.linuxDescription'),
  body: (
    <InfoLine icon={InfoIcon}>{ctx.t('update.linuxBody', { version: CURRENT_VERSION })}</InfoLine>
  ),
  footer: (
    <PairFooter
      ctx={ctx}
      onClose={onClose}
      primaryLabel={ctx.t('update.openReleases')}
      primaryIcon={ExternalLinkIcon}
      onPrimary={onOpenReleases}
    />
  ),
});

type SelfHostedArgs = {
  ctx: ViewCtx;
  onClose: () => void;
  onOpenSelfHostedDocs: () => void;
};

const selfHostedWebView = ({ ctx, onClose, onOpenSelfHostedDocs }: SelfHostedArgs): ViewParts => ({
  description: ctx.t('update.selfHostedDescription'),
  body: (
    <div className="flex flex-col gap-3">
      <InfoLine icon={ServerIcon}>
        {ctx.t('update.selfHostedBody', { version: CURRENT_VERSION })}
      </InfoLine>
      <pre className="rounded-md bg-muted px-3 py-2 text-[0.7rem] font-mono leading-relaxed whitespace-pre-wrap break-all">
        curl -fsSL https://raw.githubusercontent.com/rzru/nightingale/main/scripts/install.sh | bash
      </pre>
    </div>
  ),
  footer: (
    <PairFooter
      ctx={ctx}
      onClose={onClose}
      primaryLabel={ctx.t('update.openDocs')}
      primaryIcon={ExternalLinkIcon}
      onPrimary={onOpenSelfHostedDocs}
    />
  ),
});
