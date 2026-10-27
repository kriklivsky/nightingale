import { useCallback, useEffect, useMemo, useState } from 'react';

import type { NavAction } from '@/app/providers/nav-input-context';
import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useNavInput } from '@/features/menu/hooks/use-nav-input';
import { useSearch } from '@/features/menu/hooks/use-search';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import { useHardwareKeyboard } from '@/shared/hooks/use-hardware-keyboard';
import type { MessageKey, Translate } from '@/shared/i18n/translator';
import { useI18n } from '@/shared/i18n/use-i18n';
import { cn } from '@/shared/utils/cn';

type Layout = 'ru' | 'en';
type Position = { row: number; column: number };
type Control = 'layout' | 'backspace' | 'space' | 'clear' | 'done';

const DIGITS = '1 2 3 4 5 6 7 8 9 0 - /'.split(' ');
const LETTERS: Record<Layout, string[][]> = {
  ru: [
    'й ц у к е н г ш щ з х ъ'.split(' '),
    'ф ы в а п р о л д ж э'.split(' '),
    'я ч с м и т ь б ю ё'.split(' '),
  ],
  en: [
    'q w e r t y u i o p'.split(' '),
    'a s d f g h j k l'.split(' '),
    'z x c v b n m'.split(' '),
  ],
};
const CONTROLS: readonly Control[] = ['layout', 'backspace', 'space', 'clear', 'done'];
const CONTROL_LABEL_KEYS: Record<Exclude<Control, 'layout' | 'backspace'>, MessageKey> = {
  space: 'search.space',
  clear: 'search.clear',
  done: 'search.done',
};

function controlLabel(t: Translate, control: Control, layout: Layout): string {
  if (control === 'layout') {
    return layout === 'ru' ? 'ABC' : 'АБВ';
  }
  if (control === 'backspace') {
    return '⌫';
  }
  return t(CONTROL_LABEL_KEYS[control]);
}

function move(position: Position, action: NavAction, rowLengths: readonly number[]): Position {
  if (action.up || action.down) {
    const row = Math.min(rowLengths.length - 1, Math.max(0, position.row + (action.up ? -1 : 1)));
    return { row, column: Math.min(position.column, (rowLengths[row] ?? 1) - 1) };
  }
  if (action.left || action.right) {
    const limit = (rowLengths[position.row] ?? 1) - 1;
    return {
      ...position,
      column: Math.min(limit, Math.max(0, position.column + (action.left ? -1 : 1))),
    };
  }
  return position;
}

export function SongSearchDialog() {
  const { t } = useI18n();
  const { close } = useDialog();
  const { search, setSearch } = useSearch();
  const [draft, setDraft] = useState(search);
  const [layout, setLayout] = useState<Layout>('ru');
  const [position, setPosition] = useState<Position>({ row: 1, column: 0 });
  const keyboard = useHardwareKeyboard(true);
  const hardware = keyboard.data === true;
  const focusSelected = useCallback((button: HTMLButtonElement | null) => button?.focus(), []);
  const focusInput = useCallback((input: HTMLInputElement | null) => input?.focus(), []);
  const rows = useMemo(() => [DIGITS, ...LETTERS[layout]], [layout]);
  const rowLengths = useMemo(() => [...rows.map((row) => row.length), CONTROLS.length], [rows]);

  const updateDraft = useCallback(
    (value: string) => {
      setDraft(value);
      setSearch(value.trim());
    },
    [setSearch],
  );

  useEffect(() => {
    const typeCharacter = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.isComposing
      ) {
        return;
      }
      if (event.key === 'Backspace' || Array.from(event.key).length === 1) {
        event.preventDefault();
        updateDraft(
          event.key === 'Backspace' ? Array.from(draft).slice(0, -1).join('') : draft + event.key,
        );
      }
    };
    window.addEventListener('keydown', typeCharacter);
    return () => window.removeEventListener('keydown', typeCharacter);
  }, [draft, updateDraft]);

  const activateControl = useCallback(
    (control: Control) => {
      switch (control) {
        case 'layout':
          setLayout((current) => (current === 'ru' ? 'en' : 'ru'));
          break;
        case 'backspace':
          updateDraft(Array.from(draft).slice(0, -1).join(''));
          break;
        case 'space':
          updateDraft(`${draft} `);
          break;
        case 'clear':
          updateDraft('');
          break;
        case 'done':
          close();
          break;
      }
    },
    [close, draft, updateDraft],
  );

  useNavInput(
    useCallback(
      (action) => {
        if (hardware) {
          if (action.back || action.confirm) {
            close();
          }
          return;
        }
        if (action.back) {
          close();
        } else if (action.confirm) {
          if (position.row < rows.length) {
            const character = rows[position.row]?.[position.column];
            if (character) {
              updateDraft(draft + character);
            }
          } else {
            const control = CONTROLS[position.column];
            activateControl(control);
          }
        } else {
          setPosition((current) => move(current, action, rowLengths));
        }
      },
      [activateControl, close, draft, hardware, position, rowLengths, rows, updateDraft],
    ),
  );

  return (
    <Dialog open modal={false} onOpenChange={close}>
      <DialogContent
        className="top-auto bottom-4 max-h-[calc(100vh-2rem)] translate-y-0 gap-3 overflow-y-auto p-4 sm:max-w-5xl"
        showCloseButton={false}
        showOverlay={false}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-xl">{t('search.title')}</DialogTitle>
          <DialogDescription>{t('search.description')}</DialogDescription>
        </DialogHeader>
        {hardware ? (
          <Input
            ref={focusInput}
            value={draft}
            aria-label={t('search.text')}
            placeholder={t('search.placeholder')}
            onChange={(event) => updateDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'Escape') {
                event.preventDefault();
                close();
              }
            }}
          />
        ) : (
          <output
            className="min-h-14 rounded-lg border bg-muted/30 px-4 py-3 text-lg break-all"
            aria-label={t('search.text')}
            aria-live="polite"
          >
            {draft || <span className="text-muted-foreground">{t('search.placeholder')}</span>}
          </output>
        )}
        {keyboard.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t('search.keyboardDetectionFailed')}
          </p>
        )}
        {!hardware && (
          <div className="grid gap-1.5" aria-label={t('search.onScreenKeyboard')}>
            {rows.map((row, rowIndex) => (
              <div
                key={row.join('')}
                className="grid gap-1.5"
                style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}
              >
                {row.map((character, columnIndex) => {
                  const selected = position.row === rowIndex && position.column === columnIndex;
                  return (
                    <Button
                      key={character}
                      ref={selected ? focusSelected : undefined}
                      variant="outline"
                      className={cn(
                        'h-12 w-full min-w-0 p-0 text-lg',
                        selected && 'ring-2 ring-primary',
                      )}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => {
                        setPosition({ row: rowIndex, column: columnIndex });
                        updateDraft(draft + character);
                      }}
                    >
                      {character}
                    </Button>
                  );
                })}
              </div>
            ))}
            <div className="grid grid-cols-5 gap-2">
              {CONTROLS.map((control, columnIndex) => {
                const selected = position.row === rows.length && position.column === columnIndex;
                return (
                  <Button
                    key={control}
                    ref={selected ? focusSelected : undefined}
                    variant={control === 'done' ? 'default' : 'outline'}
                    className={cn('h-12 min-w-0 px-2 text-base', selected && 'ring-2 ring-primary')}
                    tabIndex={selected ? 0 : -1}
                    aria-label={control === 'backspace' ? t('search.backspace') : undefined}
                    onClick={() => {
                      setPosition({ row: rows.length, column: columnIndex });
                      activateControl(control);
                    }}
                  >
                    {controlLabel(t, control, layout)}
                  </Button>
                );
              })}
            </div>
          </div>
        )}
        {hardware && <Button onClick={close}>{t('search.done')}</Button>}
      </DialogContent>
    </Dialog>
  );
}
