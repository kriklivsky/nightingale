import { useRef, useState } from 'react';

import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import type { Translate } from '@/shared/i18n/translator';
import { useI18n } from '@/shared/i18n/use-i18n';

export const REPORT_PAGE_SIZE = 6;

type ResultAction = { label: string; primary: boolean; onClick: () => void };

type Options = {
  open: boolean;
  phraseCount: number;
  nextPending: boolean;
  exitLabel: string;
  onBack: () => void;
  onNext?: () => void;
  extraActions?: readonly ResultAction[];
};

function detailActions(
  t: Translate,
  page: number,
  pages: number,
  setPage: (page: number | null) => void,
): ResultAction[] {
  const actions: ResultAction[] = [];
  if (page > 0) {
    actions.push({
      label: t('result.previousLines'),
      primary: false,
      onClick: () => setPage(page - 1),
    });
  }
  if (page + 1 < pages) {
    actions.push({ label: t('result.nextLines'), primary: true, onClick: () => setPage(page + 1) });
  }
  actions.push({ label: t('result.overview'), primary: false, onClick: () => setPage(null) });
  return actions;
}

export function useResultReportNav({
  open,
  phraseCount,
  nextPending,
  exitLabel,
  onBack,
  onNext,
  extraActions = [],
}: Options) {
  const { t } = useI18n();
  const [page, setPage] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pages = Math.ceil(phraseCount / REPORT_PAGE_SIZE);
  const actions: ResultAction[] = [];
  const changePage = (nextPage: number | null) => {
    setPage(nextPage);
    focusSegment(nextPage !== null && nextPage > 0 ? 1 : 0);
  };

  if (page !== null) {
    actions.push(...detailActions(t, page, pages, changePage));
  } else {
    if (onNext) {
      actions.push({
        label: nextPending ? t('result.preparing') : t('result.nextSong'),
        primary: true,
        onClick: onNext,
      });
    }
    if (phraseCount > 0) {
      actions.push({
        label: t('result.lineReport'),
        primary: !onNext,
        onClick: () => changePage(0),
      });
    }
    actions.push(...extraActions);
    actions.push({ label: exitLabel, primary: false, onClick: onBack });
  }

  const { focusedIndex, focusSegment } = useDialogNav({
    open,
    itemCount: actions.length,
    containerRef,
    onConfirm: (index) => {
      if (!nextPending) {
        actions[index]?.onClick();
      }
    },
    onBack: () => {
      if (page === null) {
        onBack();
      } else {
        changePage(null);
      }
    },
  });

  return { page, pages, actions, focusedIndex, containerRef };
}
