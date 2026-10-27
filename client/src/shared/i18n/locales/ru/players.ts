import type { Message } from '../../translator';
import type { players as en } from '../en/players';

export const players: Record<keyof typeof en, Message> = {
  'multiplayer.title': 'Игроки',
  'multiplayer.description': 'Выберите по одному микрофону на каждого исполнителя.',
  'multiplayer.descriptionQueue':
    'Выберите по одному микрофону на каждого исполнителя. Этот состав сохранится для всех песен в очереди.',
  'multiplayer.start': 'Начать мультиплеер',
  'multiplayer.addPlayer': 'Добавить игрока',
  'multiplayer.removePlayer': 'Удалить игрока {number}',
  'multiplayer.chooseColorFor': 'Выбрать цвет игрока {number}',
  'multiplayer.guest': 'Гость',
  'multiplayer.selectMicrophone': 'Выберите микрофон',
  'multiplayer.selectedMicrophone': 'Выбранный микрофон: {id}',
  'multiplayer.combineChannels': 'Объединять каналы',
  'multiplayer.colorTitle': 'Цвет игрока',
  'multiplayer.colorDescription': 'Этим цветом игрок будет отмечен во время песни.',
  'multiplayer.error.microphones':
    'Не удалось получить список микрофонов. Проверьте разрешение на микрофон и повторите.',
  'multiplayer.error.tooFewMicrophones': 'Для мультиплеера подключите хотя бы два микрофона.',
  'multiplayer.error.duplicateMicrophone': 'Каждому игроку нужен свой микрофон.',
  'multiplayer.error.duplicateProfile': 'Сохранённый профиль можно выбрать только один раз.',
  'multiplayer.error.missingMicrophone': 'Выберите подключённый микрофон для каждого игрока.',

  'color.rose': 'Розовый',
  'color.fuchsia': 'Фуксия',
  'color.amber': 'Янтарный',
  'color.emerald': 'Изумрудный',
};
