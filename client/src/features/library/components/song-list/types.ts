import type { QueuedStatus } from '@/types/QueuedStatus';
import type { Song } from '@/types/Song';

export type SongItemProps = {
  song: Song;
  queueStatus?: QueuedStatus;
  index: number;
  isFocused: boolean;
  isSelected: boolean;
  isFavorite: boolean;
  focusedAction: number | null;
  canPlay: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
  onPlay: () => void;
  onDelete: () => void;
};
