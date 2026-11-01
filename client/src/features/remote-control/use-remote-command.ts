import { useEffect } from 'react';

import { onRemoteCommand, type RemoteCommand } from '@/bridge/remote-control';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';

type CommandType = RemoteCommand['type'];
type CommandOf<K extends CommandType> = Extract<RemoteCommand, { type: K }>;
export type RemoteCommandHandlers = Partial<{
  [K in CommandType]: (command: CommandOf<K>) => void;
}>;

const runCommand = <K extends CommandType>(
  handlers: RemoteCommandHandlers,
  command: CommandOf<K>,
): void => {
  handlers[command.type]?.(command);
};

/** Runs phone remote commands with the handlers of the screen that is showing. */
export function useRemoteCommand(handlers: RemoteCommandHandlers) {
  const handlersRef = useLatestRef(handlers);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void onRemoteCommand((command) => runCommand(handlersRef.current, command)).then((stop) => {
      if (cancelled) {
        stop();
      } else {
        unlisten = stop;
      }
      return undefined;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [handlersRef]);
}
