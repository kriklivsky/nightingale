import { CheckCircle2Icon } from 'lucide-react';

import { InfoLine, SoloFooter, type ViewCtx, type ViewParts } from '../parts';

type Args = {
  ctx: ViewCtx;
  version: string;
  onRestart: () => void;
};

export const installedView = ({ ctx, version, onRestart }: Args): ViewParts => ({
  description: ctx.t('update.description'),
  body: <InfoLine icon={CheckCircle2Icon}>{ctx.t('update.installed', { version })}</InfoLine>,
  footer: <SoloFooter ctx={ctx} label={ctx.t('update.restartNow')} onClick={onRestart} />,
});
