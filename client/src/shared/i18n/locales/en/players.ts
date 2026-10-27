import type { Message } from '../../translator';

export const players = {
  'multiplayer.title': 'Set up players',
  'multiplayer.description': 'Choose one microphone per singer.',
  'multiplayer.descriptionQueue':
    'Choose one microphone per singer. This lineup stays active for every queued song.',
  'multiplayer.start': 'Start multiplayer',
  'multiplayer.addPlayer': 'Add player',
  'multiplayer.removePlayer': 'Remove player {number}',
  'multiplayer.chooseColorFor': 'Choose color for player {number}',
  'multiplayer.guest': 'Guest',
  'multiplayer.selectMicrophone': 'Select microphone',
  'multiplayer.selectedMicrophone': 'Selected microphone: {id}',
  'multiplayer.combineChannels': 'Combine multi-channel',
  'multiplayer.colorTitle': 'Choose player color',
  'multiplayer.colorDescription': 'Choose the color used for this player during playback.',
  'multiplayer.error.microphones':
    'Could not load microphones. Check microphone permission and try again.',
  'multiplayer.error.tooFewMicrophones': 'Connect at least two microphones to start multiplayer.',
  'multiplayer.error.duplicateMicrophone': 'Each player needs a different microphone.',
  'multiplayer.error.duplicateProfile': 'A saved profile can only be used once.',
  'multiplayer.error.missingMicrophone': 'Select a connected microphone for every player.',

  'color.rose': 'Rose',
  'color.fuchsia': 'Fuchsia',
  'color.amber': 'Amber',
  'color.emerald': 'Emerald',
} satisfies Record<string, Message>;
