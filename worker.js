importScripts('https://unpkg.com/@ffmpeg/ffmpeg@0.12.7/dist/umd/ffmpeg.js');
importScripts('https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd/util.js');

const ffmpeg = new FFmpegWASM.FFmpeg();
const fetchFile = FFmpegUtil.fetchFile;

self.onmessage = async (event) => {
  const { action, audioFile, settings } = event.data;
  if (action === 'PROCESS') {
    try {
      self.postMessage({ status: 'loading', text: 'Memuat Mesin DSP...', progress: 0 });
      
      if (!ffmpeg.loaded) {
        await ffmpeg.load({
          coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
          wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
        });
      }

      // Menangkap Progress Asli dari FFmpeg (0% - 100%)
      ffmpeg.on('progress', ({ progress, time }) => {
        let percent = Math.round(progress * 100);
        if (percent > 100) percent = 100;
        if (percent < 0) percent = 0;
        self.postMessage({ status: 'processing', text: 'Memproses Audio...', progress: percent });
      });

      self.postMessage({ status: 'processing', text: 'Membaca file audio...', progress: 5 });
      await ffmpeg.writeFile('input.wav', await fetchFile(audioFile));

      // --- RUMUS MATEMATIKA DSP ---
      let pitchShift = parseFloat(settings.pitch.replace(',', '.')) || 0;
      let tempoPct = (parseFloat(settings.tempo) || 100) / 100;
      let rateMultiplier = Math.pow(2, pitchShift / 12);
      let newSampleRate = 48000 * rateMultiplier;
      let atempoFix = tempoPct / rateMultiplier;

      let audioFilters = [];
      
      // Pitch & Tempo
      if (pitchShift !== 0 || tempoPct !== 1) audioFilters.push(`asetrate=${newSampleRate},atempo=${atempoFix}`);
      
      // Jitter & Smear
      if (parseFloat(settings.jitterLFO) > 0 || parseFloat(settings.peakSmearDepth) > 0) {
        let jitterHz = parseFloat(settings.jitterLFO) || 0.1;
        let smearDepth = parseFloat(settings.peakSmearDepth) || 1.0;
        audioFilters.push(`chorus=0.5:0.9:50:0.4:${jitterHz}:2:t=s`);
        audioFilters.push(`flanger=delay=${smearDepth}:depth=2:regen=0:width=71:speed=${parseFloat(settings.peakSmearLFO)||0.5}:phase=25`);
      }
      
      // Side-channel
      if (parseFloat(settings.sideChannelJitter) > 0) audioFilters.push('extrastereo=m=0.8:c=c');
      
      // EQ Tilt & Notch
      if (parseFloat(settings.eqTiltMax) !== 0) {
         let tilt = parseFloat(settings.eqTiltMax);
         audioFilters.push(`treble=g=${tilt},bass=g=${-tilt}`);
      }
      if (settings.eqNotch && settings.eqNotch !== '') audioFilters.push(`anequalizer=c0 f=${settings.eqNotch} w=100 g=-20`);
      
      // Reverb & Silence Pad
      if (parseFloat(settings.reverbWet) > 0) audioFilters.push(`aecho=0.8:0.9:1000:0.3`);
      if (parseFloat(settings.silencePad) > 0) audioFilters.push(`apad=pad_dur=${settings.silencePad}`);
      
      // Normalize
      if (settings.normalize) audioFilters.push('loudnorm');

      let filterString = audioFilters.length > 0 ? audioFilters.join(',') : 'anull';

      // --- EKSEKUSI TAHAP 1 (Mangle & Instrumental) ---
      self.postMessage({ status: 'processing', text: 'Menerapkan Filter DSP & Ekstraksi Vokal...', progress: 10 });
      
      if (settings.instrumentalOnly === 'Hard' || settings.instrumentalOnly === 'Light') {
         // Simulasi Vocal Cancel
         await ffmpeg.exec(['-i', 'input.wav', '-af', 'pan=stereo|c0=c0-c1|c1=c1-c0', 'temp1.wav']);
      } else if (settings.lyricBypass && !settings.isInstrumentalSong) {
         // Simulasi Demucs (Vocal Stem Mangle) via Phase Isolation
         const mangleFilter = `[0:a]asplit=2[mid][side];[mid]pan=mono|c0=0.5*c0+0.5*c1,bandpass=f=1500:width_type=h:w=2000,flanger=delay=10:depth=10:regen=0:width=71:speed=3:phase=25[vocal];[side]pan=stereo|c0=c0-c1|c1=c1-c0[inst];[inst][vocal]amix=inputs=2:duration=first[out]`;
         await ffmpeg.exec(['-i', 'input.wav', '-filter_complex', mangleFilter, '-map', '[out]', 'temp1.wav']);
      } else {
         await ffmpeg.exec(['-i', 'input.wav', '-af', filterString, 'temp1.wav']);
      }

      // --- EKSEKUSI TAHAP 2 (VBR & Sub-audio) ---
      self.postMessage({ status: 'processing', text: 'Encoding MP3 VBR & Sub-audio...', progress: 50 });
      let bitrate = settings.mp3Bitrate || '192';
      let vbrFlag = settings.vbrMode ? ['-q:a', '0'] : ['-b:a', `${bitrate}k`];
      
      await ffmpeg.exec(['-i', 'temp1.wav', ...vbrFlag, '-ar', settings.sampleRate || '48000', 'temp.mp3']);

      let subAudioGain = settings.subAudioGain || '-60';
      let subAudioFreq = parseFloat(settings.subAudioInject) || 0;
      
      if (subAudioFreq > 0) {
        await ffmpeg.exec(['-i', 'temp.mp3', '-f', 'lavfi', '-i', `sine=frequency=${subAudioFreq}:sample_rate=48000`, '-filter_complex', `[1:a]volume=${subAudioGain}dB[sub];[0:a][sub]amix=inputs=2:duration=first`, 'output.wav']);
      } else {
        await ffmpeg.exec(['-i', 'temp.mp3', 'output.wav']);
      }

      self.postMessage({ status: 'processing', text: 'Menyelesaikan file...', progress: 95 });
      const data = await ffmpeg.readFile('output.wav');
      
      self.postMessage({ status: 'done', resultBuffer: data.buffer, progress: 100 }, [data.buffer]);
    } catch (error) {
      self.postMessage({ status: 'error', text: error.message, progress: 0 });
    }
  }
};