import type { Message } from '../../translator';

export const common = {
  'common.on': 'On',
  'common.cancel': 'Cancel',
  'common.retry': 'Retry',
  'common.unknownError': 'unknown error',
  'common.back': 'Back',
  'common.close': 'Close',
  'common.loading': 'Loading',
  'common.off': 'Off',
} satisfies Record<string, Message>;
