import { useQuery } from '@tanstack/react-query';

import { hardwareKeyboardAvailable } from '@/bridge/keyboard';

export function useHardwareKeyboard(enabled: boolean) {
  return useQuery({
    queryKey: ['hardware-keyboard'],
    queryFn: hardwareKeyboardAvailable,
    enabled,
    staleTime: 1000,
    refetchInterval: enabled ? 2000 : false,
    retry: false,
  });
}
