// =====================================================================
// MENGGUNAKAN FFMPEG LOKAL (DARI HOSTING VERCEL SENDIRI)
// =====================================================================
const baseURL = self.location.origin;

// Import script dari Vercel kita sendiri
self.importScripts(baseURL + '/ffmpeg.js');
self.importScripts(baseURL + '/util.js');

self.onerror = function(e) {
  self.postMessage({ status: 'error', text: 'Error Sistem: ' + e.message, progress: 0 });
};

self.onmessage = async (event) => {
  const { action, audioFile, settings } = event.data;
  
  if (action === 'PROCESS') {
    try {
      self.postMessage({ status: 'loading', text: 'Menyiapkan sistem lokal...', progress: 5 });

      const ffmpeg = new self.FFmpegWASM.FFmpeg();
      const fetchFile = self.FFmpegUtil.fetchFile;
      
      if (!ffmpeg.loaded) {
        try {
          self.postMessage({ status: 'loading', text: 'Memuat mesin AI (30MB) dari Vercel...', progress: 10 });
          
          // Load core dari Vercel kita sendiri
          await ffmpeg.load({
            coreURL: baseURL + '/ffmpeg-core.js',
            wasmURL: baseURL + '/ffmpeg-core.wasm',
          });
        } catch (err) {
          throw new Error("Gagal memuat ffmpeg-core lokal. Error: " + err.message);
        }
      }

      ffmpeg.on('progress', ({ progress }) => {
        let percent = Math.round(progress * 100);
        if (percent > 100) percent = 100;
        if (percent < 0) percent = 0;
        self.postMessage({ status: 'processing', text: 'Memproses Audio...', progress: percent });
      });

      self.postMessage({ status: 'processing', text: 'Membaca file audio...', progress: 15 });
      await ffmpeg.writeFile('input.wav', await fetchFile(audioFile));

      // =====================================================================
      // LOGIKA AUDIO DSP ASLI MILIK ANDA
      // =====================================================================
      let pitchShift = parseFloat(settings.pitch.replace(',', '.')) || 0;
      let tempoPct = (parseFloat(settings.tempo) || 100) / 100;
      let rateMultiplier = Math.pow(2, pitchShift / 12);
      let newSampleRate = Math.round(48000 * rateMultiplier); 
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
      if (parseFloat(settings.reverbWet) > 0) audioFilters.push(`aecho=0.8:0.9:1000:0.3`);
      if (parseFloat(settings.silencePad) > 0) audioFilters.push(`apad=pad_dur=${settings.silencePad}`);
      if (settings.normalize) audioFilters.push('loudnorm');

      let filterString = audioFilters.length > 0 ? audioFilters.join(',') : 'anull';

      self.postMessage({ status: 'processing', text: 'Menerapkan Filter DSP...', progress: 20 });
      
      if (settings.instrumentalOnly === 'Hard' || settings.instrumentalOnly === 'Light') {
         await ffmpeg.exec(['-i', 'input.wav', '-af', 'pan=stereo|c0=c0-c1|c1=c1-c0', 'temp1.wav']);
      } else if (settings.lyricBypass && !settings.isInstrumentalSong) {
         const mangleFilter = `[0:a]asplit=2[mid][side];[mid]pan=mono|c0=0.5*c0+0.5*c1,bandpass=f=1500:width_type=h:w=2000,flanger=delay=10:depth=10:regen=0:width=71:speed=3:phase=25[vocal];[side]pan=stereo|c0=c0-c1|c1=c1-c0[inst];[inst][vocal]amix=inputs=2:duration=first[out]`;
         await ffmpeg.exec(['-i', 'input.wav', '-filter_complex', mangleFilter, '-map', '[out]', 'temp1.wav']);
      } else {
         await ffmpeg.exec(['-i', 'input.wav', '-af', filterString, 'temp1.wav']);
      }

      self.postMessage({ status: 'processing', text: 'Encoding MP3 VBR...', progress: 60 });
      let bitrate = settings.mp3Bitrate || '192';
      let vbrFlag = settings.vbrMode ? ['-q:a', '0'] : ['-b:a', `${bitrate}k`];
      
      await ffmpeg.exec(['-i', 'temp1.wav', ...vbrFlag, '-ar', settings.sampleRate || '48000', 'temp.mp3']);

      let subAudioGain = settings.subAudioGain || '-60';
      let subAudioFreq = parseFloat(settings.subAudioInject) || 0;
      
      if (subAudioFreq > 0) {
        self.postMessage({ status: 'processing', text: 'Injecting Sub-audio...', progress: 80 });
        await ffmpeg.exec(['-i', 'temp.mp3', '-f', 'lavfi', '-i', `sine=frequency=${subAudioFreq}:sample_rate=48000`, '-filter_complex', `[1:a]volume=${subAudioGain}dB[sub];[0:a][sub]amix=inputs=2:duration=first`, 'output.wav']);
      } else {
        await ffmpeg.exec(['-i', 'temp.mp3', 'output.wav']);
      }

      self.postMessage({ status: 'processing', text: 'Menyelesaikan file...', progress: 95 });
      const data = await ffmpeg.readFile('output.wav');
      
      self.postMessage({ status: 'done', resultBuffer: data.buffer, progress: 100 }, [data.buffer]);
      
    } catch (error) {
      self.postMessage({ status: 'error', text: error.message || String(error), progress: 0 });
    }
  }
};