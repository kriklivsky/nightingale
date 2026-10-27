import { z } from 'zod';

import { invoke, isTauri } from './runtime';

export async function hardwareKeyboardAvailable(): Promise<boolean> {
  return isTauri ? z.boolean().parse(await invoke('hardware_keyboard_available')) : true;
}
