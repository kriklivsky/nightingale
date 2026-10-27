import type { Messages } from '../translator';
import { common } from './ru/common';
import { content } from './ru/content';
import { library } from './ru/library';
import { menu } from './ru/menu';
import { playback } from './ru/playback';
import { players } from './ru/players';
import { settings } from './ru/settings';

export const ru: Messages = {
  ...common,
  ...content,
  ...library,
  ...menu,
  ...playback,
  ...players,
  ...settings,
};
