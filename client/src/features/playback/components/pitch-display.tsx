import { usePlaybackMicState, usePlaybackTransportState } from '@/features/playback/providers';

import { PitchGraph } from './pitch-graph';
import { PitchLane } from './pitch-lane';

type PitchDisplayProps = {
  mode: string | null | undefined;
  position: 'top' | 'bottom';
  scale: number | null | undefined;
};

/** Solo pitch feedback: the note lane by default, or the compact meter when chosen in settings. */
export function PitchDisplay({ mode, position, scale }: PitchDisplayProps) {
  const { paused, referenceContour } = usePlaybackTransportState();
  const { series, micReady, micUserEnabled, multiplayer, latencySec } = usePlaybackMicState();

  if (multiplayer) {
    return null;
  }
  if (mode !== 'meter' && referenceContour !== null) {
    return (
      <PitchLane
        contour={referenceContour}
        series={series}
        latencySec={latencySec}
        micUserEnabled={micUserEnabled}
        paused={paused}
        position={position}
        scale={scale}
      />
    );
  }
  return (
    <PitchGraph
      series={series}
      micReady={micReady}
      micUserEnabled={micUserEnabled}
      paused={paused}
      position={position}
      scale={scale}
    />
  );
}
