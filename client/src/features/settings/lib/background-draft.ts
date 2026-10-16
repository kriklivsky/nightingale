import { usesNativeBackgroundPicker } from '@/bridge/backgrounds';

export type BackgroundDraft = {
  sourceType: 'upload' | 'url';
  name: string;
  url: string;
  file: File | undefined;
  nativePath: string | undefined;
  nativeFileName: string | undefined;
};

export const createBackgroundDraft = (): BackgroundDraft => ({
  sourceType: 'upload',
  name: '',
  url: '',
  file: undefined,
  nativePath: undefined,
  nativeFileName: undefined,
});

export function canSubmitBackground(draft: BackgroundDraft, busy: boolean): boolean {
  if (busy || draft.name.trim() === '') {
    return false;
  }
  if (draft.sourceType === 'url') {
    return draft.url.trim() !== '';
  }
  return usesNativeBackgroundPicker ? draft.nativePath !== undefined : draft.file !== undefined;
}
