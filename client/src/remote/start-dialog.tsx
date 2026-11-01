import { useQuery } from '@tanstack/react-query';
import { PlusIcon, XIcon } from 'lucide-react';
import { useState } from 'react';

import type { PlaybackPlayer } from '@/bridge/playback-session';
import type { RemoteStartCommand } from '@/bridge/remote-control';
import type { MicDevice } from '@/features/microphone/queries/use-mic-devices';
import {
  initialPlayers,
  playerSetupStatus,
  setupError,
} from '@/features/playback/lib/multiplayer-players';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Label } from '@/shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Spinner } from '@/shared/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { useI18n } from '@/shared/i18n/use-i18n';
import { defaultPlayerColor, playerColorOption } from '@/shared/player-colors';

import { loadSetup, sendCommand, type RemoteMicrophone, type StartSetup } from './api';
import { ErrorText } from './error-text';
import { useRemoteAction } from './use-remote';

const MAX_PLAYERS = 4;
const GUEST_VALUE = 'guest';
const PROFILE_PREFIX = 'profile:';

export type StartRequest = { kind: 'queue' } | { kind: 'song'; fileHash: string; title: string };

const profileValue = (profile: string | null): string =>
  profile === null ? GUEST_VALUE : `${PROFILE_PREFIX}${profile}`;

const parseProfile = (value: string): string | null =>
  value.startsWith(PROFILE_PREFIX) ? value.slice(PROFILE_PREFIX.length) : null;

const micDevices = (microphones: readonly RemoteMicrophone[]): MicDevice[] =>
  microphones.map(({ id, label }) => ({ deviceId: id, label, name: label, channelCount: 1 }));

type ChoiceProps = {
  id: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
};

function Choice({ id, label, value, options, onChange }: ChoiceProps) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          id={id}
          className="min-h-11 w-full min-w-0 text-left text-base whitespace-normal data-[size=default]:h-auto *:data-[slot=select-value]:line-clamp-2"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

type FormProps = {
  setup: StartSetup;
  busy: boolean;
  onStart: (mode: RemoteStartCommand['mode']) => void;
};

function SoloForm({ setup, busy, onStart }: FormProps) {
  const { t } = useI18n();
  const microphones = setup.soloMicrophones;
  const [profile, setProfile] = useState(setup.activeProfile ?? setup.profiles.at(0) ?? null);
  const [microphone, setMicrophone] = useState(
    microphones.find((mic) => mic.id === setup.preferredMicrophone)?.id ??
      microphones.at(0)?.id ??
      null,
  );

  return (
    <div className="flex flex-col gap-3">
      {setup.profiles.length > 0 && profile !== null ? (
        <Choice
          id="solo-profile"
          label={t('remote.profile')}
          value={profile}
          options={setup.profiles.map((name) => ({ value: name, label: name }))}
          onChange={setProfile}
        />
      ) : null}
      {microphone === null ? (
        <p className="text-sm text-destructive">{t('remote.noMicrophones')}</p>
      ) : (
        <Choice
          id="solo-microphone"
          label={t('remote.microphone')}
          value={microphone}
          options={microphones.map((mic) => ({ value: mic.id, label: mic.label }))}
          onChange={setMicrophone}
        />
      )}
      <Button
        size="lg"
        className="h-11 text-sm"
        disabled={busy}
        onClick={() => onStart({ kind: 'solo', microphoneId: microphone, profile })}
      >
        {t('remote.start')}
      </Button>
    </div>
  );
}

function MultiplayerForm({ setup, busy, onStart }: FormProps) {
  const { t } = useI18n();
  const microphones = micDevices(setup.multiplayerMicrophones);
  const [players, setPlayers] = useState<PlaybackPlayer[]>(() =>
    initialPlayers({
      activeProfile: setup.activeProfile,
      profiles: setup.profiles,
      microphones,
      preferredMicrophone: setup.preferredMicrophone,
      rememberedPlayers: setup.rememberedPlayers,
    }),
  );
  const status = playerSetupStatus(players, microphones, false);
  const error = setupError({
    microphonesError: false,
    microphoneCount: microphones.length,
    duplicateMicrophone: status.duplicateMicrophone,
    duplicateProfile: status.duplicateProfile,
    validMicrophones: status.validMicrophones,
  });
  const profileOptions = [
    { value: GUEST_VALUE, label: t('multiplayer.guest') },
    ...setup.profiles.map((name) => ({ value: profileValue(name), label: name })),
  ];
  const microphoneOptions = microphones.map((mic) => ({ value: mic.deviceId, label: mic.label }));
  const update = (id: string, patch: Partial<PlaybackPlayer>) =>
    setPlayers((current) =>
      current.map((player) => (player.id === id ? { ...player, ...patch } : player)),
    );
  const addPlayer = () =>
    setPlayers((current) => {
      const used = new Set(current.map((player) => player.microphoneId));
      const number = Math.max(...current.map((player) => Number(player.id.split('-')[1]))) + 1;
      return [
        ...current,
        {
          id: `player-${number}`,
          profile: null,
          microphoneId: microphones.find((mic) => !used.has(mic.deviceId))?.deviceId ?? '',
          color: defaultPlayerColor(current.length),
        },
      ];
    });

  return (
    <div className="flex flex-col gap-4">
      {players.map((player, index) => (
        <fieldset key={player.id} className="flex min-w-0 flex-col gap-2 rounded-lg border p-3">
          <legend className="flex items-center gap-2 px-1 text-sm font-medium">
            <span
              className={`size-2.5 rounded-full ${playerColorOption(player.color).className}`}
            />
            {t('remote.player', { number: index + 1 })}
            {index >= 2 ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setPlayers((current) => current.filter((p) => p.id !== player.id))}
                aria-label={t('multiplayer.removePlayer', { number: index + 1 })}
              >
                <XIcon />
              </Button>
            ) : null}
          </legend>
          <Choice
            id={`${player.id}-profile`}
            label={t('remote.profile')}
            value={profileValue(player.profile)}
            options={profileOptions}
            onChange={(value) => update(player.id, { profile: parseProfile(value) })}
          />
          <Choice
            id={`${player.id}-microphone`}
            label={t('remote.microphone')}
            value={player.microphoneId}
            options={microphoneOptions}
            onChange={(microphoneId) => update(player.id, { microphoneId })}
          />
        </fieldset>
      ))}
      {players.length < MAX_PLAYERS ? (
        <Button variant="outline" className="h-11 text-sm" onClick={addPlayer}>
          <PlusIcon /> {t('multiplayer.addPlayer')}
        </Button>
      ) : null}
      {error === null ? null : (
        <p className="text-sm text-destructive" role="alert">
          {t(error)}
        </p>
      )}
      <Button
        size="lg"
        className="h-11 text-sm"
        disabled={busy || !status.canStart}
        onClick={() => onStart({ kind: 'multiplayer', players })}
      >
        {t('remote.start')}
      </Button>
    </div>
  );
}

type StartDialogProps = {
  request: StartRequest | null;
  onClose: () => void;
};

export function StartDialog({ request, onClose }: StartDialogProps) {
  const { t } = useI18n();
  const setup = useQuery({
    queryKey: ['remote-setup'],
    queryFn: loadSetup,
    enabled: request !== null,
    staleTime: 0,
  });
  const start = useRemoteAction(sendCommand);
  const run = (mode: RemoteStartCommand['mode']) => {
    if (request === null) {
      return;
    }
    const target: RemoteStartCommand['target'] =
      request.kind === 'queue' ? { kind: 'queue' } : { kind: 'song', fileHash: request.fileHash };
    start.mutate({ type: 'start', target, mode }, { onSuccess: onClose });
  };
  const title =
    request?.kind === 'song'
      ? t('remote.startSong', { title: request.title })
      : t('remote.startQueue');

  return (
    <Dialog open={request !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        {setup.data === undefined ? (
          <Spinner className="mx-auto my-6 size-6" />
        ) : (
          <Tabs defaultValue="solo" className="min-w-0">
            <TabsList className="h-11 w-full">
              <TabsTrigger value="solo" className="text-sm">
                {t('remote.solo')}
              </TabsTrigger>
              <TabsTrigger value="multiplayer" className="text-sm">
                {t('remote.multiplayer')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="solo" className="mt-3">
              <SoloForm setup={setup.data} busy={start.isLoading} onStart={run} />
            </TabsContent>
            <TabsContent value="multiplayer" className="mt-3">
              <MultiplayerForm setup={setup.data} busy={start.isLoading} onStart={run} />
            </TabsContent>
          </Tabs>
        )}
        {setup.isError ? <ErrorText error={setup.error} /> : null}
      </DialogContent>
    </Dialog>
  );
}
