import { useRef, useState } from 'react';

import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';

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
  page: number,
  pages: number,
  setPage: (page: number | null) => void,
): ResultAction[] {
  const actions: ResultAction[] = [];
  if (page > 0) {
    actions.push({ label: 'Previous lines', primary: false, onClick: () => setPage(page - 1) });
  }
  if (page + 1 < pages) {
    actions.push({ label: 'Next lines', primary: true, onClick: () => setPage(page + 1) });
  }
  actions.push({ label: 'Overview', primary: false, onClick: () => setPage(null) });
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
  const [page, setPage] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pages = Math.ceil(phraseCount / REPORT_PAGE_SIZE);
  const actions: ResultAction[] = [];
  const changePage = (nextPage: number | null) => {
    setPage(nextPage);
    focusSegment(nextPage !== null && nextPage > 0 ? 1 : 0);
  };

  if (page !== null) {
    actions.push(...detailActions(page, pages, changePage));
  } else {
    if (onNext) {
      actions.push({
        label: nextPending ? 'Preparing…' : 'Next Song',
        primary: true,
        onClick: onNext,
      });
    }
    if (phraseCount > 0) {
      actions.push({
        label: 'Line-by-line report',
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
