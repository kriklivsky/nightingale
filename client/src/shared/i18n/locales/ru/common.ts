import type { Message } from '../../translator';
import type { common as en } from '../en/common';

export const common: Record<keyof typeof en, Message> = {
  'common.on': 'Вкл',
  'common.cancel': 'Отмена',
  'common.retry': 'Повторить',
  'common.unknownError': 'неизвестная ошибка',
  'common.back': 'Назад',
  'common.close': 'Закрыть',
  'common.loading': 'Загрузка',
  'common.off': 'Выкл',
};
