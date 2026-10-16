"""Keep song analysis behind interactive playback on Linux CPUs."""

import os
import sys
from pathlib import Path


def set_background_priority(report=False):
    if sys.platform != 'linux':
        return
    try:
        for task in Path('/proc/self/task').iterdir():
            try:
                tid = int(task.name)
                current = os.getpriority(os.PRIO_PROCESS, tid)
                os.setpriority(os.PRIO_PROCESS, tid, max(10, current))
            except ProcessLookupError:
                continue
        if report:
            value = os.getpriority(os.PRIO_PROCESS, 0)
            print(f'[nightingale:LOG] Analyzer CPU background priority: nice={value}', flush=True)
    except OSError as error:
        print(f'[nightingale:LOG] WARNING: Cannot lower analyzer CPU priority: {error.strerror}',
              file=sys.stderr, flush=True)
