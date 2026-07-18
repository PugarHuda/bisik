import { Composition } from 'remotion';
import { BisikPitch, TOTAL_FRAMES, FPS } from './BisikPitch';

export const RemotionRoot = () => (
  <Composition
    id="BisikPitch"
    component={BisikPitch}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
