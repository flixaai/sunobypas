importScripts('https://unpkg.com/@ffmpeg/ffmpeg@0.12.7/dist/umd/ffmpeg.js');
importScripts('https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd/util.js');

const ffmpeg = new FFmpegWASM.FFmpeg();
const fetchFile = FFmpegUtil.fetchFile;

self.onmessage = async (event) => {
  const { action, audioFile, settings } = event.data;
  if (action === 'PROCESS') {
    try {
      self.postMessage({ status: 'loading', text: 'Loading FFmpeg Engine...' });
      if (!ffmpeg.loaded) {
        await ffmpeg.load({
          coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
          wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
        });
      }

      self.postMessage({ status: 'processing', text: 'Reading audio...' });
      await ffmpeg.writeFile('input.wav', await fetchFile(audioFile));

      let pitchShift = parseFloat(settings.pitch.replace(',', '.')) || 0;
      let tempoPct = (parseFloat(settings.tempo) || 100) / 100;
      let rateMultiplier = Math.pow(2, pitchShift / 12);
      let newSampleRate = 48000 * rateMultiplier;
      let atempoFix = tempoPct / rateMultiplier;

      let audioFilters = [];
      if (pitchShift !== 0 || tempoPct !== 1) audioFilters.push(`asetrate=${newSampleRate},atempo=${atempoFix}`);
      if (parseFloat(settings.jitterLFO) > 0 || parseFloat(settings.peakSmearDepth) > 0) {
        let jitterHz = parseFloat(settings.jitterLFO) || 0.1;
        let smearDepth = parseFloat(settings.peakSmearDepth) || 1.0;
        audioFilters.push(`chorus=0.5:0.9:50:0.4:${jitterHz}:2:t=s`);
        audioFilters.push(`flanger=delay=${smearDepth}:depth=2:regen=0:width=71:speed=${parseFloat(settings.peakSmearLFO)||0.5}:phase=25`);
      }
      if (parseFloat(settings.sideChannelJitter) > 0) audioFilters.push('extrastereo=m=0.8:c=c');
      if (parseFloat(settings.eqTiltMax) !== 0) {
         let tilt = parseFloat(settings.eqTiltMax);
         audioFilters.push(`treble=g=${tilt},bass=g=${-tilt}`);
      }
      if (settings.eqNotch && settings.eqNotch !== '') audioFilters.push(`anequalizer=c0 f=${settings.eqNotch} w=100 g=-20`);

      let filterString = audioFilters.length > 0 ? audioFilters.join(',') : 'anull';

      self.postMessage({ status: 'processing', text: 'Applying DSP Mangling...' });
      let bitrate = settings.mp3Bitrate || '192';
      let vbrFlag = settings.vbrMode ? ['-q:a', '0'] : ['-b:a', `${bitrate}k`];
      
      await ffmpeg.exec(['-i', 'input.wav', '-af', filterString, ...vbrFlag, '-ar', settings.sampleRate || '48000', 'temp.mp3']);

      self.postMessage({ status: 'processing', text: 'Finalizing Audio...' });
      let subAudioGain = settings.subAudioGain || '-60';
      let subAudioFreq = parseFloat(settings.subAudioInject) || 0;
      
      if (subAudioFreq > 0) {
        await ffmpeg.exec(['-i', 'temp.mp3', '-f', 'lavfi', '-i', `sine=frequency=${subAudioFreq}:sample_rate=48000`, '-filter_complex', `[1:a]volume=${subAudioGain}dB[sub];[0:a][sub]amix=inputs=2:duration=first`, 'output.wav']);
      } else {
        await ffmpeg.exec(['-i', 'temp.mp3', 'output.wav']);
      }

      const data = await ffmpeg.readFile('output.wav');
      self.postMessage({ status: 'done', resultBuffer: data.buffer }, [data.buffer]);
    } catch (error) {
      self.postMessage({ status: 'error', text: error.message });
    }
  }
};