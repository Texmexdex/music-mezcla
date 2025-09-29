import React, { useState, useRef, useEffect, useCallback } from 'react';
import { VocalTrack, InstrumentalAudioNodes, AutopilotMode, EffectSettings, EffectType, VocalAudioNodes } from './types';
import { nanoid } from 'nanoid';

// --- Helper Functions ---
const createImpulseResponse = (audioContext: AudioContext, duration = 2, decay = 2) => {
  const sampleRate = audioContext.sampleRate;
  const length = sampleRate * duration;
  const impulse = audioContext.createBuffer(2, length, sampleRate);
  const impulseL = impulse.getChannelData(0);
  const impulseR = impulse.getChannelData(1);
  for (let i = 0; i < length; i++) {
    const n = length - i;
    impulseL[i] = (Math.random() * 2 - 1) * Math.pow(n / length, decay);
    impulseR[i] = (Math.random() * 2 - 1) * Math.pow(n / length, decay);
  }
  return impulse;
};

const defaultEffectSettings: EffectSettings = {
  reverbMix: 0,
  delayTime: 0.5,
  delayFeedback: 0.4,
  delayMix: 0,
  pitchShift: 0,
  distortionAmount: 50,
  distortionMix: 0,
  tremoloRate: 5,
  tremoloMix: 0,
};


// --- Main Component ---
const App = () => {
  const [vocalTracks, setVocalTracks] = useState<VocalTrack[]>([]);
  const [instrumental, setInstrumental] = useState<{ buffer: AudioBuffer; nodes: InstrumentalAudioNodes | null; name: string } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sliderValue, setSliderValue] = useState(0);
  const [isSetup, setIsSetup] = useState(true);
  const [normalize, setNormalize] = useState(true);
  const [activeEffectTab, setActiveEffectTab] = useState<string | null>(null);
  const [instrumentalVolume, setInstrumentalVolume] = useState(0.7);
  const [masterVocalVolume, setMasterVocalVolume] = useState(0.9);
  const [autopilot, setAutopilot] = useState<AutopilotMode>('off');
  const [autopilotSpeed, setAutopilotSpeed] = useState(0.2);
  const [masterVolume, setMasterVolume] = useState(0.8);
  const [backgroundLevel, setBackgroundLevel] = useState(0);
  const [wantsToPlay, setWantsToPlay] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const masterVocalGainRef = useRef<GainNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number>(0);
  const autopilotFrameRef = useRef<number>(0);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  }, []);

  const decodeFile = async (file: File): Promise<AudioBuffer> => {
    const audioContext = getAudioContext();
    const arrayBuffer = await file.arrayBuffer();
    return audioContext.decodeAudioData(arrayBuffer);
  };

  const handleVocalFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    const decodedTracks = await Promise.all(
      files.map(async (file) => {
        const buffer = await decodeFile(file);
        return {
          id: nanoid(),
          name: file.name,
          buffer,
          nodes: null,
          effectType: 'none' as EffectType,
          effects: { ...defaultEffectSettings },
          volume: 1.0,
        };
      })
    );
    setVocalTracks(decodedTracks);
    if (decodedTracks.length > 0) {
      setActiveEffectTab(decodedTracks[0].id);
    }
  };

  const handleInstrumentalFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const buffer = await decodeFile(file);
    setInstrumental({ buffer, nodes: null, name: file.name });
  };
  
   const setupAudioGraph = useCallback(() => {
    const audioContext = getAudioContext();
    if (!masterGainRef.current) {
      masterGainRef.current = audioContext.createGain();
      masterGainRef.current.connect(audioContext.destination);
    }
    if (!masterVocalGainRef.current) {
      masterVocalGainRef.current = audioContext.createGain();
      masterVocalGainRef.current.connect(masterGainRef.current);
    }
    if (!analyserRef.current) {
      analyserRef.current = audioContext.createAnalyser();
      analyserRef.current.fftSize = 256;
      masterGainRef.current.connect(analyserRef.current);
    }

    const updatedVocalTracks = vocalTracks.map(track => {
      if (track.nodes) return track; // Already setup
      
      const gain = audioContext.createGain();
      gain.gain.value = 0;
      const volumeGain = audioContext.createGain();
      volumeGain.gain.value = track.volume;
      const panner = audioContext.createStereoPanner();
      const reverb = audioContext.createConvolver();
      reverb.buffer = createImpulseResponse(audioContext);
      const reverbWet = audioContext.createGain();
      const reverbDry = audioContext.createGain();
      const reverbMixNode = audioContext.createGain();
      const delay = audioContext.createDelay(5.0);
      const delayWet = audioContext.createGain();
      const delayDry = audioContext.createGain();
      const delayFeedback = audioContext.createGain();
      delayFeedback.gain.value = 0;
      const delayMixNode = audioContext.createGain();
      const distortion = audioContext.createWaveShaper();
      const distortionWet = audioContext.createGain();
      const distortionDry = audioContext.createGain();
      const distortionMixNode = audioContext.createGain();
      const tremolo = audioContext.createGain();
      const tremoloLfo = audioContext.createOscillator();
      tremoloLfo.frequency.value = 5;
      const tremoloDepth = audioContext.createGain();
      tremoloDepth.gain.value = 0;
      tremoloLfo.connect(tremoloDepth);
      tremoloDepth.connect(tremolo.gain);
      tremoloLfo.start();
      
      // Wire graph: Source -> Panner -> Effects Chain -> Volume -> Crossfade -> Master
      panner.connect(reverbDry);
      panner.connect(reverb);
      reverb.connect(reverbWet);
      reverbDry.connect(reverbMixNode);
      reverbWet.connect(reverbMixNode);
      reverbMixNode.connect(delayDry);
      reverbMixNode.connect(delay);
      delay.connect(delayFeedback);
      delayFeedback.connect(delay);
      delay.connect(delayWet);
      delayDry.connect(delayMixNode);
      delayWet.connect(delayMixNode);
      delayMixNode.connect(distortionDry);
      delayMixNode.connect(distortion);
      distortion.connect(distortionWet);
      distortionDry.connect(distortionMixNode);
      distortionWet.connect(distortionMixNode);
      distortionMixNode.connect(tremolo);
      tremolo.connect(volumeGain);
      volumeGain.connect(gain);
      gain.connect(masterVocalGainRef.current!);

      const newNodes: Omit<VocalAudioNodes, 'source'> = { 
        gain, panner, volumeGain,
        reverb, reverbWet, reverbDry, reverbMixNode,
        delay, delayWet, delayDry, delayFeedback, delayMixNode,
        pitchShifter: null, 
        distortion, distortionWet, distortionDry, distortionMixNode,
        tremolo, tremoloLfo, tremoloDepth 
      };

      return { ...track, nodes: { ...newNodes, source: null as any } }; // Source will be added on play
    });
    setVocalTracks(updatedVocalTracks);

    if (instrumental?.buffer && !instrumental.nodes) {
      const gain = audioContext.createGain();
      gain.gain.value = instrumentalVolume; // FIX: Set initial volume right away
      gain.connect(masterGainRef.current!);
      setInstrumental({ ...instrumental, nodes: { source: null as any, gain } });
    }
  }, [getAudioContext, vocalTracks, instrumental, instrumentalVolume]);

  const updateVocalGains = useCallback((val: number) => {
    if (vocalTracks.length < 2) {
      if(vocalTracks.length === 1 && vocalTracks[0].nodes) {
          vocalTracks[0].nodes.gain.gain.value = 1;
      }
      return;
    }

    const numSegments = vocalTracks.length - 1;
    vocalTracks.forEach((track, index) => {
        if (!track.nodes) return;
        const trackPosition = index / numSegments;
        const distance = Math.abs(val - trackPosition);
        const segmentWidth = 1 / numSegments;
        let gainValue = 0;
        if (distance < segmentWidth) {
            const localVal = (distance / segmentWidth) * (Math.PI / 2);
            gainValue = Math.cos(localVal);
        }
        track.nodes.gain.gain.linearRampToValueAtTime(gainValue, audioContextRef.current!.currentTime + 0.01);
    });
  }, [vocalTracks]);
  
  useEffect(() => {
    updateVocalGains(sliderValue);
  }, [sliderValue, updateVocalGains]);

  const startPlayback = useCallback(() => {
    const audioContext = getAudioContext();
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    
    // Stop any existing sources before creating new ones
    vocalTracks.forEach(t => t.nodes?.source?.stop());
    instrumental?.nodes?.source?.stop();
    
    const startTime = audioContext.currentTime;

    setVocalTracks(currentTracks => currentTracks.map(track => {
      const source = audioContext.createBufferSource();
      source.buffer = track.buffer;
      source.connect(track.nodes!.panner);
      source.start(startTime);
      return { ...track, nodes: { ...track.nodes!, source } };
    }));
    
    if (instrumental?.buffer && instrumental.nodes) {
      const source = audioContext.createBufferSource();
      source.buffer = instrumental.buffer;
      source.connect(instrumental.nodes.gain);
      source.start(startTime);
      setInstrumental(currentInst => ({ ...currentInst!, nodes: { ...currentInst!.nodes!, source } }));
    }
    setIsPlaying(true);
  }, [vocalTracks, instrumental, getAudioContext]);


  const stopPlayback = useCallback(() => {
    vocalTracks.forEach(t => t.nodes?.source?.stop());
    instrumental?.nodes?.source?.stop();
    setIsPlaying(false);
    cancelAnimationFrame(animationFrameRef.current);
    cancelAnimationFrame(autopilotFrameRef.current);
  }, [vocalTracks, instrumental]);

  const togglePlay = () => {
    if (isPlaying) {
        stopPlayback();
    } else {
        setupAudioGraph(); // Ensure graph is ready before play
        setWantsToPlay(true); // Signal intention to play
    }
  }
  
  // Effect to handle starting playback safely after state updates
  useEffect(() => {
    if (wantsToPlay) {
      startPlayback();
      setWantsToPlay(false); // Reset the trigger
    }
  }, [wantsToPlay, startPlayback]);


  const handleFinalizeSetup = () => {
    let tracksToProcess = [...vocalTracks];
    if (normalize) {
        const audioContext = getAudioContext();
        tracksToProcess = tracksToProcess.map(track => {
            const buffer = track.buffer;
            let trackPeak = 0;
            for (let i = 0; i < buffer.numberOfChannels; i++) {
                const data = buffer.getChannelData(i);
                const peak = data.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
                if (peak > trackPeak) trackPeak = peak;
            }

            if (trackPeak > 0) {
                const gainToApply = 1.0 / trackPeak;
                const newBuffer = audioContext.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
                for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
                    const inputData = buffer.getChannelData(channel);
                    const outputData = newBuffer.getChannelData(channel);
                    for (let sample = 0; sample < inputData.length; sample++) {
                        outputData[sample] = inputData[sample] * gainToApply;
                    }
                }
                return { ...track, buffer: newBuffer };
            }
            return track;
        });
    }
    setVocalTracks(tracksToProcess);
    setIsSetup(false);
  };

  // Effect application logic
  useEffect(() => {
    vocalTracks.forEach(track => {
      if (!track.nodes || !audioContextRef.current) return;
      
      const { nodes, effectType, effects } = track;
      const now = audioContextRef.current.currentTime;
      const rampTime = now + 0.02;

      // Update individual track volume
      if (nodes.volumeGain) {
          nodes.volumeGain.gain.linearRampToValueAtTime(track.volume, rampTime);
      }
      
      // Only apply full effect chain to the active track
      if (track.id !== activeEffectTab) {
        // Reset effects for inactive tracks
        nodes.reverbWet.gain.linearRampToValueAtTime(0, rampTime);
        nodes.reverbDry.gain.linearRampToValueAtTime(1, rampTime);
        nodes.delayWet.gain.linearRampToValueAtTime(0, rampTime);
        nodes.delayDry.gain.linearRampToValueAtTime(1, rampTime);
        nodes.distortionWet.gain.linearRampToValueAtTime(0, rampTime);
        nodes.distortionDry.gain.linearRampToValueAtTime(1, rampTime);
        nodes.tremoloDepth.gain.linearRampToValueAtTime(0, rampTime);
        return;
      };

      // Apply active track's effects
      const reverbMix = effectType === 'reverb' ? effects.reverbMix : 0;
      nodes.reverbWet.gain.linearRampToValueAtTime(reverbMix, rampTime);
      nodes.reverbDry.gain.linearRampToValueAtTime(1 - reverbMix, rampTime);
      
      if (effectType === 'delay') {
        nodes.delay.delayTime.setValueAtTime(effects.delayTime, now);
        nodes.delayFeedback.gain.linearRampToValueAtTime(effects.delayFeedback, rampTime);
        nodes.delayWet.gain.linearRampToValueAtTime(effects.delayMix, rampTime);
        nodes.delayDry.gain.linearRampToValueAtTime(1 - effects.delayMix, rampTime);
      } else {
        nodes.delayWet.gain.linearRampToValueAtTime(0, rampTime);
        nodes.delayDry.gain.linearRampToValueAtTime(1, rampTime);
      }
      
      if (effectType === 'distortion') {
          const amount = effects.distortionAmount;
          const k = typeof amount === 'number' ? amount : 50;
          const n_samples = 44100;
          const curve = new Float32Array(n_samples);
          const deg = Math.PI / 180;
          for (let i = 0; i < n_samples; ++i) {
              const x = i * 2 / n_samples - 1;
              curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
          }
          nodes.distortion.curve = curve;
          nodes.distortion.oversample = '4x';
          nodes.distortionWet.gain.linearRampToValueAtTime(effects.distortionMix, rampTime);
          nodes.distortionDry.gain.linearRampToValueAtTime(1 - effects.distortionMix, rampTime);
      } else {
          nodes.distortionWet.gain.linearRampToValueAtTime(0, rampTime);
          nodes.distortionDry.gain.linearRampToValueAtTime(1, rampTime);
      }

      if (effectType === 'tremolo') {
          nodes.tremoloLfo.frequency.setValueAtTime(effects.tremoloRate, now);
          nodes.tremoloDepth.gain.linearRampToValueAtTime(effects.tremoloMix, rampTime);
      } else {
          nodes.tremoloDepth.gain.linearRampToValueAtTime(0, rampTime);
      }
    });
  }, [vocalTracks, activeEffectTab]);

  const updateTrack = (trackId: string, updates: Partial<VocalTrack>) => {
      setVocalTracks(vocalTracks.map(t => t.id === trackId ? { ...t, ...updates } : t));
  };

  const updateEffect = (trackId: string, newEffects: Partial<EffectSettings>, newType?: EffectType) => {
    setVocalTracks(vocalTracks.map(t => {
      if (t.id === trackId) {
        return {
          ...t,
          effectType: newType !== undefined ? newType : t.effectType,
          effects: { ...t.effects, ...newEffects }
        };
      }
      return t;
    }));
  };

  const resetEffects = (trackId: string) => {
    setVocalTracks(vocalTracks.map(t => {
        if(t.id === trackId) {
            return {
                ...t,
                effectType: 'none',
                effects: defaultEffectSettings,
            };
        }
        return t;
    }));
  };

  // Autopilot, Audio-reactive background, and Timeline update loops
  useEffect(() => {
    if (!isPlaying) {
      cancelAnimationFrame(animationFrameRef.current);
      cancelAnimationFrame(autopilotFrameRef.current);
      return;
    }
    
    // Autopilot state
    let position = sliderValue;
    let velocity = 0;
    let targetPosition = sliderValue;
    let lastSwitchTime = 0;
    const swellDuration = 4 / Math.max(0.1, autopilotSpeed);
    
    const animate = () => {
        const now = audioContextRef.current!.currentTime;

        // Autopilot Logic
        switch(autopilot) {
            case 'smooth':
                position = 0.5 + 0.5 * Math.sin(2 * Math.PI * autopilotSpeed * now);
                break;
            case 'stutter':
                if (Math.random() < (1 / 60) * autopilotSpeed * 2) {
                    position = Math.floor(Math.random() * vocalTracks.length) / (vocalTracks.length - 1 || 1);
                }
                break;
            case 'randomWalk':
                targetPosition += (Math.random() - 0.5) * 0.01 * autopilotSpeed;
                targetPosition = Math.max(0, Math.min(1, targetPosition));
                position += (targetPosition - position) * 0.05; // Smoothly move towards target
                break;
            case 'glitch':
                if (Math.random() < (1 / 60) * autopilotSpeed * 5) {
                    const targetTrack = Math.floor(Math.random() * vocalTracks.length);
                    const randomOffset = (Math.random() - 0.5) * 0.1;
                    position = (targetTrack / (vocalTracks.length - 1 || 1)) + randomOffset;
                    position = Math.max(0, Math.min(1, position));
                }
                break;
            case 'swell':
                 if(now > lastSwitchTime + swellDuration) {
                     lastSwitchTime = now;
                     targetPosition = Math.floor(Math.random() * vocalTracks.length) / (vocalTracks.length - 1 || 1);
                 }
                 // Smooth easing towards the target
                 position += (targetPosition - position) * 0.01;
                break;
        }
        if (autopilot !== 'off') setSliderValue(position);

        // Analyser Logic
        if (analyserRef.current) {
            const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
            analyserRef.current.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((sum, val) => sum + val, 0) / dataArray.length;
            setBackgroundLevel(average / 128);
        }
        
        animationFrameRef.current = requestAnimationFrame(animate);
    }
    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
        cancelAnimationFrame(animationFrameRef.current);
        cancelAnimationFrame(autopilotFrameRef.current);
    }
  }, [isPlaying, autopilot, autopilotSpeed, vocalTracks.length, sliderValue]);

  // Volume controls
  useEffect(() => {
    if (masterVocalGainRef.current) masterVocalGainRef.current.gain.value = masterVocalVolume;
  }, [masterVocalVolume]);
  
  useEffect(() => {
    if (instrumental?.nodes) instrumental.nodes.gain.gain.value = instrumentalVolume;
  }, [instrumentalVolume, instrumental?.nodes]);

  useEffect(() => {
    if (masterGainRef.current) masterGainRef.current.gain.value = masterVolume;
  }, [masterVolume]);

  const renderSetup = () => (
    <div className="max-w-4xl mx-auto p-8 bg-gray-800 rounded-lg shadow-lg">
      <h1 className="text-4xl font-bold text-center mb-2 text-cyan-400">TeX's Music Mezcla</h1>
      <p className="text-center text-gray-400 mb-8">Creative Vocal Blender</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold text-gray-200 border-b-2 border-cyan-500 pb-2">1. Load Vocal Tracks</h2>
          <p className="text-gray-400 text-sm">Select multiple vocal recordings. These should have the same lyrics and timing.</p>
          <input type="file" multiple onChange={handleVocalFiles} className="file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-cyan-600 file:text-white hover:file:bg-cyan-700 block w-full text-sm text-gray-400" />
          <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
            {vocalTracks.map(t => <div key={t.id} className="bg-gray-700 p-2 rounded text-sm truncate">{t.name}</div>)}
          </div>
        </div>
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold text-gray-200 border-b-2 border-cyan-500 pb-2">2. Load Instrumental</h2>
          <p className="text-gray-400 text-sm">Select one backing track or instrumental file.</p>
          <input type="file" onChange={handleInstrumentalFile} className="file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-cyan-600 file:text-white hover:file:bg-cyan-700 block w-full text-sm text-gray-400" />
          {instrumental && <div className="bg-gray-700 p-2 rounded text-sm truncate">{instrumental.name}</div>}
        </div>
      </div>
      <div className="mt-8">
        <h2 className="text-2xl font-semibold text-gray-200 border-b-2 border-cyan-500 pb-2">3. Options</h2>
        <div className="flex items-center mt-4">
          <input type="checkbox" id="normalize" checked={normalize} onChange={e => setNormalize(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-cyan-600 focus:ring-cyan-500" />
          <label htmlFor="normalize" className="ml-2 block text-sm text-gray-300">Normalize Vocal Volumes (Recommended)</label>
        </div>
      </div>
      <div className="mt-10 text-center">
        <button
          onClick={handleFinalizeSetup}
          disabled={vocalTracks.length === 0}
          className="bg-green-600 text-white font-bold py-3 px-12 rounded-full disabled:bg-gray-500 disabled:cursor-not-allowed hover:bg-green-700 transition-transform transform hover:scale-105"
        >
          Start Mixing
        </button>
      </div>
    </div>
  );

  const renderMixer = () => {
    const activeTrack = vocalTracks.find(t => t.id === activeEffectTab);

    return (
      <div className="w-full max-w-7xl mx-auto p-4 md:p-8 space-y-6">
         <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-cyan-400">TeX's Music Mezcla</h1>
            <button onClick={togglePlay} className="w-24 bg-cyan-600 text-white font-bold py-2 px-4 rounded-full hover:bg-cyan-700 transition">
              {isPlaying ? 'Stop' : 'Play'}
            </button>
         </div>

        {/* --- Main Mixer Panel --- */}
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
          <h2 className="text-xl font-semibold mb-4">Master Mixer</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
             <div className="space-y-4">
                <label className="block">Vocal Blend Volume: {Math.round(masterVocalVolume * 100)}%</label>
                <input type="range" min="0" max="1" step="0.01" value={masterVocalVolume} onChange={e => setMasterVocalVolume(parseFloat(e.target.value))} className="w-full" />
                <label className="block">Instrumental Volume: {Math.round(instrumentalVolume * 100)}%</label>
                <input type="range" min="0" max="1" step="0.01" value={instrumentalVolume} onChange={e => setInstrumentalVolume(parseFloat(e.target.value))} className="w-full" />
             </div>
             <div className="space-y-4">
                <label className="block font-bold text-lg text-cyan-400">Master Out: {Math.round(masterVolume * 100)}%</label>
                <input type="range" min="0" max="1" step="0.01" value={masterVolume} onChange={e => setMasterVolume(parseFloat(e.target.value))} className="w-full" />
             </div>
          </div>
        </div>

        {/* --- Vocal Blender --- */}
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
          <h2 className="text-xl font-semibold mb-2">Vocal Blender</h2>
          <p className="text-gray-400 text-sm mb-4">Slide to shift between vocal tracks.</p>
          <input type="range" min="0" max="1" step="0.001" value={sliderValue} onChange={e => setSliderValue(parseFloat(e.target.value))} className="w-full" disabled={autopilot !== 'off'} />
          <div className="flex justify-between text-xs mt-2 text-gray-400">
             {vocalTracks.map(t => <span key={t.id} className="truncate w-1/4 text-center">{t.name}</span>)}
          </div>
        </div>

        {/* --- Autopilot --- */}
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
            <h2 className="text-xl font-semibold mb-4">Autopilot</h2>
            <div className="flex flex-wrap gap-4 items-center">
                <select value={autopilot} onChange={e => setAutopilot(e.target.value as AutopilotMode)} className="bg-gray-700 text-white rounded p-2">
                    <option value="off">Off</option>
                    <option value="smooth">Smooth</option>
                    <option value="stutter">Stutter</option>
                    <option value="randomWalk">Random Walk</option>
                    <option value="glitch">Glitch</option>
                    <option value="swell">Swell</option>
                </select>
                {(autopilot === 'smooth' || autopilot === 'randomWalk' || autopilot === 'glitch' || autopilot === 'swell') && (
                    <div className="flex-grow flex items-center gap-4">
                        <label className="text-sm">Speed:</label>
                        <input type="range" min="0.05" max="2" step="0.01" value={autopilotSpeed} onChange={e => setAutopilotSpeed(parseFloat(e.target.value))} className="w-full" />
                    </div>
                )}
                 {autopilot === 'stutter' && (
                    <div className="flex-grow flex items-center gap-4">
                        <label className="text-sm">Jumps/Sec:</label>
                        <input type="range" min="0.5" max="10" step="0.1" value={autopilotSpeed} onChange={e => setAutopilotSpeed(parseFloat(e.target.value))} className="w-full" />
                    </div>
                )}
            </div>
        </div>
        
        {/* --- Effects Panel --- */}
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Vocal Effects</h2>
            <button onClick={() => activeTrack && resetEffects(activeTrack.id)} className="bg-red-600 text-white text-xs font-bold py-1 px-3 rounded-full hover:bg-red-700 transition">Reset Effects</button>
          </div>
          <div className="flex border-b border-gray-600 overflow-x-auto">
            {vocalTracks.map(track => (
              <button key={track.id} onClick={() => setActiveEffectTab(track.id)} className={`px-4 py-2 text-sm truncate flex-shrink-0 ${activeEffectTab === track.id ? 'border-b-2 border-cyan-400 text-cyan-400' : 'text-gray-400 hover:bg-gray-700'}`}>
                {track.name}
              </button>
            ))}
          </div>
          <div className="pt-4">
            {!activeTrack ? <p>Select a vocal track to apply effects.</p> : (
              <div>
                 <div className="mb-4">
                    <label>Track Volume: {Math.round(activeTrack.volume * 100)}%</label>
                    <input type="range" min="0" max="1.5" step="0.01" value={activeTrack.volume} onChange={e => updateTrack(activeTrack.id, { volume: parseFloat(e.target.value) })} className="w-full" />
                  </div>
                <div className="flex items-center gap-4 mb-4 border-t border-gray-700 pt-4">
                  <label className="font-semibold">Effect:</label>
                  <select
                    value={activeTrack.effectType}
                    onChange={e => updateEffect(activeTrack.id, {}, e.target.value as EffectType)}
                    className="bg-gray-700 text-white rounded p-2"
                  >
                    <option value="none">None</option>
                    <option value="reverb">Reverb</option>
                    <option value="delay">Delay</option>
                    <option value="distortion">Distortion</option>
                    <option value="tremolo">Tremolo</option>
                  </select>
                </div>

                {activeTrack.effectType === 'reverb' && (
                  <div>
                    <label>Mix: {Math.round(activeTrack.effects.reverbMix * 100)}%</label>
                    <input type="range" min="0" max="1" step="0.01" value={activeTrack.effects.reverbMix} onChange={e => updateEffect(activeTrack.id, { reverbMix: parseFloat(e.target.value) })} className="w-full" />
                  </div>
                )}
                {activeTrack.effectType === 'delay' && (
                  <div className="space-y-2">
                    <label>Time: {activeTrack.effects.delayTime.toFixed(2)}s</label>
                    <input type="range" min="0.01" max="2" step="0.01" value={activeTrack.effects.delayTime} onChange={e => updateEffect(activeTrack.id, { delayTime: parseFloat(e.target.value) })} className="w-full" />
                    <label>Feedback: {Math.round(activeTrack.effects.delayFeedback * 100)}%</label>
                    <input type="range" min="0" max="0.95" step="0.01" value={activeTrack.effects.delayFeedback} onChange={e => updateEffect(activeTrack.id, { delayFeedback: parseFloat(e.target.value) })} className="w-full" />
                     <label>Mix: {Math.round(activeTrack.effects.delayMix * 100)}%</label>
                    <input type="range" min="0" max="1" step="0.01" value={activeTrack.effects.delayMix} onChange={e => updateEffect(activeTrack.id, { delayMix: parseFloat(e.target.value) })} className="w-full" />
                  </div>
                )}
                {activeTrack.effectType === 'distortion' && (
                  <div className="space-y-2">
                    <label>Amount: {activeTrack.effects.distortionAmount}</label>
                    <input type="range" min="0" max="400" step="1" value={activeTrack.effects.distortionAmount} onChange={e => updateEffect(activeTrack.id, { distortionAmount: parseFloat(e.target.value) })} className="w-full" />
                    <label>Mix: {Math.round(activeTrack.effects.distortionMix * 100)}%</label>
                    <input type="range" min="0" max="1" step="0.01" value={activeTrack.effects.distortionMix} onChange={e => updateEffect(activeTrack.id, { distortionMix: parseFloat(e.target.value) })} className="w-full" />
                  </div>
                )}
                {activeTrack.effectType === 'tremolo' && (
                  <div className="space-y-2">
                    <label>Rate: {activeTrack.effects.tremoloRate.toFixed(1)} Hz</label>
                    <input type="range" min="0.1" max="20" step="0.1" value={activeTrack.effects.tremoloRate} onChange={e => updateEffect(activeTrack.id, { tremoloRate: parseFloat(e.target.value) })} className="w-full" />
                     <label>Mix: {Math.round(activeTrack.effects.tremoloMix * 100)}%</label>
                    <input type="range" min="0" max="1" step="0.01" value={activeTrack.effects.tremoloMix} onChange={e => updateEffect(activeTrack.id, { tremoloMix: parseFloat(e.target.value) })} className="w-full" />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };
  
  const backgroundStyle = {
    background: `radial-gradient(circle, rgba(30, 64, 175, ${backgroundLevel * 0.3}) 0%, rgba(17, 24, 39, 0) 70%)`,
    transition: 'background 0.1s ease-out'
  };

  return (
    <div style={backgroundStyle} className="min-h-screen flex items-center justify-center p-4">
      <main className="w-full">
        {isSetup ? renderSetup() : renderMixer()}
      </main>
      <footer className="fixed bottom-0 left-0 w-full text-center text-gray-600 text-xs p-2">
        TeXmExDeX Type Tools
      </footer>
    </div>
  );
};

export default App;