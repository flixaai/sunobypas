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

      // ==========================================
      // TAHAP 1: BASIC DSP (Pitch, Tempo, Jitter, EQ)
      // ==========================================
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
      
      // Fitur Normalize Peak
      if (settings.normalize) audioFilters.push('loudnorm');

      let filterString = audioFilters.length > 0 ? audioFilters.join(',') : 'anull';

      self.postMessage({ status: 'processing', text: 'Applying DSP Mangling...' });
      await ffmpeg.exec(['-i', 'input.wav', '-af', filterString, 'temp1.wav']);

      // ==========================================
      // TAHAP 2: VOCAL MANGLE & INSTRUMENTAL ONLY
      // ==========================================
      if (settings.instrumentalOnly === 'Hard') {
         self.postMessage({ status: 'processing', text: 'Removing Vocals (Karaoke Mode)...' });
         // Fitur Instrumental: Menghapus frekuensi tengah (vokal) secara ekstrem
         await ffmpeg.exec(['-i', 'temp1.wav', '-af', 'pan=stereo|c0=c0-c1|c1=c1-c0', 'temp2.wav']);
      } 
      else if (settings.lyricBypass && !settings.isInstrumentalSong) {
         self.postMessage({ status: 'processing', text: 'Mangling Vocal Stem (Lyric Bypass)...' });
         // Fitur Lyric Bypass: Memisahkan vokal, merusaknya dengan flanger ekstrem agar AI Suno buta huruf, lalu menggabungnya lagi
         const mangleFilter = `[0:a]asplit=2[mid][side];[mid]pan=mono|c0=0.5*c0+0.5*c1,bandpass=f=1500:width_type=h:w=2000,flanger=delay=10:depth=10:regen=0:width=71:speed=3:phase=25[vocal];[side]pan=stereo|c0=c0-c1|c1=c1-c0[inst];[inst][vocal]amix=inputs=2:duration=first[out]`;
         await ffmpeg.exec(['-i', 'temp1.wav', '-filter_complex', mangleFilter, '-map', '[out]', 'temp2.wav']);
      } 
      else {
         await ffmpeg.exec(['-i', 'temp1.wav', 'temp2.wav']);
      }

      // ==========================================
      // TAHAP 3: VBR ENCODE & SUB-AUDIO INJECT
      // ==========================================
      self.postMessage({ status: 'processing', text: 'Finalizing Audio & VBR Encoding...' });
      let bitrate = settings.mp3Bitrate || '192';
      let vbrFlag = settings.vbrMode ? ['-q:a', '0'] : ['-b:a', `${bitrate}k`];
      
      await ffmpeg.exec(['-i', 'temp2.wav', ...vbrFlag, '-ar', settings.sampleRate || '48000', 'temp.mp3']);

      let subAudioGain = settings.subAudioGain || '-60';
      let subAudioFreq = parseFloat(settings.subAudioInject) || 0;
      
      if (subAudioFreq > 0) {
        self.postMessage({ status: 'processing', text: 'Injecting Sub-audio...' });
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