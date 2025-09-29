// types.ts

export type AutopilotMode = 'off' | 'smooth' | 'stutter' | 'randomWalk' | 'glitch' | 'swell';

export interface VocalAudioNodes {
  source: AudioBufferSourceNode;
  gain: GainNode; // For crossfading
  volumeGain: GainNode; // For individual track volume
  panner: StereoPannerNode;
  // Reverb
  reverb: ConvolverNode;
  reverbWet: GainNode;
  reverbDry: GainNode;
  reverbMixNode: GainNode;
  // Delay
  delay: DelayNode;
  delayWet: GainNode;
  delayDry: GainNode;
  delayFeedback: GainNode;
  delayMixNode: GainNode;
  // Distortion
  distortion: WaveShaperNode;
  distortionWet: GainNode;
  distortionDry: GainNode;
  distortionMixNode: GainNode;
  // Tremolo
  tremolo: GainNode;
  tremoloLfo: OscillatorNode;
  tremoloDepth: GainNode;
  // Pitch (Future)
  pitchShifter: AudioWorkletNode | null;
}

export interface InstrumentalAudioNodes {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export type EffectType = 'reverb' | 'delay' | 'pitch' | 'distortion' | 'tremolo' | 'none';

export interface EffectSettings {
  reverbMix: number;
  delayTime: number;
  delayFeedback: number;
  delayMix: number;
  pitchShift: number; // Semitones
  distortionAmount: number;
  distortionMix: number;
  tremoloRate: number;
  tremoloMix: number; // New for better control
}

export interface VocalTrack {
  id: string;
  name: string;
  buffer: AudioBuffer;
  nodes: VocalAudioNodes | null;
  effectType: EffectType;
  effects: EffectSettings;
  volume: number; // New for individual volume control
}
