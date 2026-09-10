// =====================================================================
// BENTENG PELINDUNG ENVIRONMENT
// =====================================================================
if (typeof window === 'undefined') {
  self.window = self;
}
if (typeof document === 'undefined') {
  self.document = { 
    currentScript: { src: '' }, 
    baseURI: self.location.href,
    createElement: function() { return {}; },
    getElementsByTagName: function() { return []; }
  };
}

self.exports = {};
self.require = function(moduleName) { return {}; };
// =====================================================================

self.onerror = function(e) {
  self.postMessage({ status: 'error', text: 'Fatal Worker Error: ' + (e.message || 'Unknown'), progress: 0 });
};

self.onmessage = async (event) => {
  const { action, audioFile, settings } = event.data;
  
  if (action === 'PROCESS') {
    try {
      const baseURL = self.location.origin;
      self.postMessage({ status: 'loading', text: 'Menyiapkan sistem...', progress: 2 });

      if (typeof self.exports.FFmpegWASM === 'undefined') {
        self.importScripts(baseURL + '/ffmpeg.js');
        self.importScripts(baseURL + '/util.js');
      }

      const ffmpeg = new self.exports.FFmpegWASM.FFmpeg();
      const fetchFile = self.exports.fetchFile;
      
      let lastLog = "";
      ffmpeg.on('log', ({ message }) => {
        console.log(message);
        lastLog = message;
      });

      if (!ffmpeg.loaded) {
        self.postMessage({ status: 'loading', text: 'Memuat mesin AI...', progress: 10 });
        await ffmpeg.load({
          coreURL: baseURL + '/ffmpeg-core.js',
          wasmURL: baseURL + '/ffmpeg-core.wasm',
        });
      }

      let currentStep = "Membaca file audio...";
      
      ffmpeg.on('progress', ({ progress }) => {
        let percent = Math.round(progress * 100);
        if (percent > 100) percent = 100;
        if (percent < 0) percent = 0;
        self.postMessage({ status: 'processing', text: currentStep, progress: percent });
      });

      self.postMessage({ status: 'processing', text: currentStep, progress: 15 });
      await ffmpeg.writeFile('input.wav', await fetchFile(audioFile));

      // =====================================================================
      // MERACIK FILTER DSP
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
      if (parseFloat(settings.silencePad) > 0) {
         let delayMs = parseFloat(settings.silencePad) * 1000;
         audioFilters.push(`adelay=${delayMs}|${delayMs}`);
      }
      if (settings.normalize) audioFilters.push('loudnorm');

      let filterString = audioFilters.length > 0 ? audioFilters.join(',') : 'anull';

      // ---------------------------------------------------------
      // TAHAP 1A: TERAPKAN PITCH, TEMPO, & DSP DASAR
      // ---------------------------------------------------------
      currentStep = "Tahap 1A: Menerapkan Filter Audio...";
      self.postMessage({ status: 'processing', text: currentStep, progress: 20 });
      try {
        let res1A = await ffmpeg.exec(['-i', 'input.wav', '-af', filterString, 'temp_dsp.wav']);
        if (res1A !== 0) throw new Error("Exit code: " + res1A);
        await ffmpeg.deleteFile('input.wav'); 
      } catch (e) {
        throw new Error("Crash Tahap 1A. LOG: " + lastLog);
      }

      // ---------------------------------------------------------
      // TAHAP 1B: SUPER ALIEN VOCAL MANGLE (PENGHANCUR SUNO)
      // ---------------------------------------------------------
      currentStep = "Tahap 1B: Menghancurkan Sidik Jari Vokal...";
      self.postMessage({ status: 'processing', text: currentStep, progress: 40 });
      try {
        let res1B;
        if (settings.instrumentalOnly === 'Hard' || settings.instrumentalOnly === 'Light') {
           res1B = await ffmpeg.exec(['-i', 'temp_dsp.wav', '-af', 'pan=stereo|c0=c0-c1|c1=c1-c0', 'temp1.wav']);
        } else if (settings.lyricBypass && !settings.isInstrumentalSong) {
           // INI DIA RACIKAN BARUNYA: Ekstrak vokal -> Beri efek Chorus berat & Vibrato ekstrim -> Gabung lagi
           const mangleFilter = `[0:a]asplit=2[mid][side];[mid]pan=mono|c0=0.5*c0+0.5*c1,bandpass=f=1200:width_type=h:w=2500,chorus=0.5:0.9:50|60|40:0.4|0.32|0.3:2|2.3|1.3:2|1|2,vibrato=f=7.0:d=0.9[vocal];[side]pan=stereo|c0=c0-c1|c1=c1-c0[inst];[inst][vocal]amix=inputs=2:duration=first[out]`;
           res1B = await ffmpeg.exec(['-i', 'temp_dsp.wav', '-filter_complex', mangleFilter, '-map', '[out]', 'temp1.wav']);
        } else {
           res1B = await ffmpeg.exec(['-i', 'temp_dsp.wav', '-c', 'copy', 'temp1.wav']);
        }
        if (res1B !== 0) throw new Error("Exit code: " + res1B);
        await ffmpeg.deleteFile('temp_dsp.wav'); 
      } catch (e) {
        throw new Error("Crash Tahap 1B. LOG: " + lastLog);
      }

      // ---------------------------------------------------------
      // TAHAP 2: ENCODING LANGSUNG KE MP3
      // ---------------------------------------------------------
      currentStep = "Tahap Akhir: Encoding MP3 Final...";
      self.postMessage({ status: 'processing', text: currentStep, progress: 70 });
      try {
        let bitrate = settings.mp3Bitrate || '192';
        let vbrFlag = settings.vbrMode ? ['-q:a', '0'] : ['-b:a', `${bitrate}k`];
        let subAudioGain = settings.subAudioGain || '-60';
        let subAudioFreq = parseFloat(settings.subAudioInject) || 0;
        
        let resFinal;
        if (subAudioFreq > 0) {
          resFinal = await ffmpeg.exec([
            '-i', 'temp1.wav', 
            '-f', 'lavfi', '-i', `sine=frequency=${subAudioFreq}:sample_rate=48000`, 
            '-filter_complex', `[1:a]volume=${subAudioGain}dB[sub];[0:a][sub]amix=inputs=2:duration=first`, 
            ...vbrFlag, '-ar', settings.sampleRate || '44100', 
            'output.mp3'
          ]);
        } else {
          resFinal = await ffmpeg.exec(['-i', 'temp1.wav', ...vbrFlag, '-ar', settings.sampleRate || '44100', 'output.mp3']);
        }
        
        if (resFinal !== 0) throw new Error("Exit code: " + resFinal);
        await ffmpeg.deleteFile('temp1.wav');
      } catch (e) {
        throw new Error("Crash Tahap 2 (MP3). LOG: " + lastLog);
      }

      currentStep = "Menyelesaikan file MP3...";
      self.postMessage({ status: 'processing', text: currentStep, progress: 95 });
      
      const data = await ffmpeg.readFile('output.mp3');
      await ffmpeg.deleteFile('output.mp3');
      
      self.postMessage({ status: 'done', resultBuffer: data.buffer, progress: 100 }, [data.buffer]);
      
    } catch (error) {
      self.postMessage({ status: 'error', text: error.message || String(error), progress: 0 });
    }
  }
};