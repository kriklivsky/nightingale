import type { PlaybackPlayer } from '@/bridge/playback-session';
import type { MicDevice } from '@/features/microphone/queries/use-mic-devices';
import type { MessageKey } from '@/shared/i18n/translator';
import { defaultPlayerColor } from '@/shared/player-colors';

function defaultPlayers(
  activeProfile: string | null,
  microphoneIds: readonly string[],
): PlaybackPlayer[] {
  return [0, 1].map((index) => ({
    id: `player-${index + 1}`,
    profile: index === 0 ? activeProfile : null,
    microphoneId: microphoneIds[index] ?? '',
    color: defaultPlayerColor(index),
  }));
}

export type InitialPlayersInput = {
  activeProfile: string | null;
  profiles: readonly string[];
  microphones: readonly MicDevice[];
  preferredMicrophone: string | null;
  rememberedPlayers: readonly PlaybackPlayer[] | null;
};

function orderedMicrophoneIds(
  microphones: readonly MicDevice[],
  preferred: string | null,
): string[] {
  const preferredDevices = microphones.filter(
    (microphone) =>
      microphone.deviceId === preferred ||
      (preferred !== null && microphone.deviceId.startsWith(`${preferred}#channel=`)) ||
      microphone.name === preferred ||
      microphone.label === preferred,
  );
  const ids = microphones.map((microphone) => microphone.deviceId);
  if (preferredDevices.length === 0) {
    return ids;
  }
  const preferredIds = new Set(preferredDevices.map((microphone) => microphone.deviceId));
  return [...preferredIds, ...ids.filter((id) => !preferredIds.has(id))];
}

export function initialPlayers(input: InitialPlayersInput): PlaybackPlayer[] {
  const microphoneIds = orderedMicrophoneIds(input.microphones, input.preferredMicrophone);
  const remembered = input.rememberedPlayers;
  if (remembered === null) {
    return defaultPlayers(input.activeProfile, microphoneIds);
  }

  const availableProfiles = new Set(input.profiles);
  const usedMicrophones = new Set<string>();
  return remembered.map((player, index) => {
    const rememberedMicrophoneAvailable =
      player.microphoneId !== '' && !usedMicrophones.has(player.microphoneId);
    const microphoneId = rememberedMicrophoneAvailable
      ? player.microphoneId
      : (microphoneIds.find((id) => !usedMicrophones.has(id)) ?? '');
    if (microphoneId !== '') {
      usedMicrophones.add(microphoneId);
    }
    return {
      id: `player-${index + 1}`,
      profile:
        player.profile !== null && availableProfiles.has(player.profile) ? player.profile : null,
      microphoneId,
      color: player.color,
    };
  });
}

export type SetupErrorInput = {
  microphonesError: boolean;
  microphoneCount: number;
  duplicateMicrophone: boolean;
  duplicateProfile: boolean;
  validMicrophones: boolean;
};

export function setupError(input: SetupErrorInput): MessageKey | null {
  if (input.microphonesError) {
    return 'multiplayer.error.microphones';
  }
  if (input.microphoneCount < 2) {
    return 'multiplayer.error.tooFewMicrophones';
  }
  if (input.duplicateMicrophone) {
    return 'multiplayer.error.duplicateMicrophone';
  }
  if (input.duplicateProfile) {
    return 'multiplayer.error.duplicateProfile';
  }
  if (!input.validMicrophones) {
    return 'multiplayer.error.missingMicrophone';
  }
  return null;
}

export type PlayerSetupStatus = {
  selectedMicrophones: Set<string>;
  duplicateProfile: boolean;
  duplicateMicrophone: boolean;
  validMicrophones: boolean;
  canStart: boolean;
};

export function playerSetupStatus(
  players: readonly PlaybackPlayer[],
  microphones: readonly MicDevice[],
  loading: boolean,
): PlayerSetupStatus {
  const selectedProfiles = new Set(
    players.flatMap((player) => (player.profile === null ? [] : [player.profile])),
  );
  const selectedMicrophones = new Set(
    players.map((player) => player.microphoneId).filter((id) => id !== ''),
  );
  const duplicateProfile =
    selectedProfiles.size !== players.filter((player) => player.profile !== null).length;
  const validMicrophones = players.every(
    (player) =>
      player.microphoneId !== '' &&
      microphones.some((microphone) => microphone.deviceId === player.microphoneId),
  );
  const duplicateMicrophone = selectedMicrophones.size !== players.length;
  const canStart =
    players.length >= 2 &&
    !loading &&
    !duplicateProfile &&
    !duplicateMicrophone &&
    validMicrophones;
  return {
    selectedMicrophones,
    duplicateProfile,
    duplicateMicrophone,
    validMicrophones,
    canStart,
  };
}
