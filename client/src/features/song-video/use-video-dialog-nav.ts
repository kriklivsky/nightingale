import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import { DIALOG_FOCUSABLE_SELECTOR, useDialogNav } from '@/features/menu/hooks/use-dialog-nav';

export function useVideoDialogNav(onBack: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [stops, setStops] = useState<number[]>([1]);
  const bind = useCallback((element: HTMLDivElement | null) => {
    ref.current = element;
    setContainer(element);
  }, []);

  useLayoutEffect(() => {
    if (!container) {
      return undefined;
    }
    const measure = () => {
      const elements = Array.from(
        container.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR),
      ).filter((element) => element.offsetWidth > 0 || element.offsetHeight > 0);
      const sizes: number[] = [];
      let previousRow: Element | null = null;
      for (const element of elements) {
        const row = element.closest('[data-video-nav-row]');
        if (row !== null && row === previousRow) {
          sizes[sizes.length - 1] += 1;
        } else {
          sizes.push(1);
        }
        previousRow = row;
      }
      setStops((previous) =>
        previous.length === sizes.length && previous.every((size, index) => size === sizes[index])
          ? previous
          : sizes,
      );
    };
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled'],
    });
    return () => observer.disconnect();
  }, [container]);

  const { focusedIndex } = useDialogNav({
    open: true,
    stops,
    itemCount: stops.reduce((sum, count) => sum + count, 0),
    containerRef: ref,
    onBack,
  });
  useLayoutEffect(() => {
    if (!container) {
      return;
    }
    const elements = Array.from(
      container.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR),
    ).filter((element) => element.offsetWidth > 0 || element.offsetHeight > 0);
    const measured = stops.reduce((total, count) => total + count, 0);
    if (elements.length !== measured) {
      return;
    }
    for (const [index, element] of elements.entries()) {
      element.dataset.videoFocused = String(index === focusedIndex);
    }
  }, [container, focusedIndex, stops]);
  return bind;
}
