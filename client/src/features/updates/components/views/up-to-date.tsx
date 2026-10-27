import { CheckCircle2Icon } from 'lucide-react';

import { CURRENT_VERSION, InfoLine, PairFooter, type ViewCtx, type ViewParts } from '../parts';

type Args = {
  ctx: ViewCtx;
  onClose: () => void;
  onRefetch: () => void;
};

export const upToDateView = ({ ctx, onClose, onRefetch }: Args): ViewParts => ({
  description: ctx.t('update.description'),
  body: (
    <InfoLine icon={CheckCircle2Icon}>
      {ctx.t('update.upToDate', { version: CURRENT_VERSION })}
    </InfoLine>
  ),
  footer: (
    <PairFooter
      ctx={ctx}
      onClose={onClose}
      primaryLabel={ctx.t('update.checkAgain')}
      onPrimary={onRefetch}
    />
  ),
});
