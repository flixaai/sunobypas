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

      ffmpeg.on('progress', ({ progress }) => {
        let percent = Math.round(progress * 100);
        if (percent > 100) percent = 100;
        if (percent < 0) percent = 0;
        self.postMessage({ status: 'processing', text: 'Memproses Audio...', progress: percent });
      });

      self.postMessage({ status: 'processing', text: 'Membaca file audio...', progress: 15 });
      await ffmpeg.writeFile('input.wav', await fetchFile(audioFile));

      // =====================================================================
      // MERACIK FILTER DSP (FOKUS PADA BASS & VOLUME KERAS)
      // =====================================================================
      let audioFilters = [];

      // 1. SILENCE PAD (Trik menggeser waktu awal lagu)
      if (parseFloat(settings.silencePad) > 0) {
         let delayMs = parseFloat(settings.silencePad) * 1000;
         audioFilters.push(`adelay=${delayMs}|${delayMs}`);
      }

      // 2. PITCH & TEMPO
      let pitchShift = parseFloat(settings.pitch.replace(',', '.')) || 0;
      let tempoPct = (parseFloat(settings.tempo) || 100) / 100;
      let rateMultiplier = Math.pow(2, pitchShift / 12);
      let newSampleRate = Math.round(48000 * rateMultiplier); 
      let atempoFix = tempoPct / rateMultiplier;
      if (pitchShift !== 0 || tempoPct !== 1) {
          audioFilters.push(`asetrate=${newSampleRate},atempo=${atempoFix}`);
      }

      // 3. EFEK LO-FI TAPE WOBBLE (PENGHANCUR COPYRIGHT)
      // Menggantikan pemisah vokal yang merusak bass. Ini akan membuat nada bergetar seperti kaset lama.
      if (settings.lyricBypass && !settings.isInstrumentalSong) {
          audioFilters.push(`vibrato=f=6.0:d=0.2`); // Getaran kaset
          audioFilters.push(`aphaser=type=t:speed=0.5:decay=0.4`); // Efek melayang tipis
      }

      // 4. LOUDNORM (MEMAKSA VOLUME JADI SANGAT KERAS & BASS MUNCUL)
      // Ini adalah standar volume Spotify. Dijamin tidak akan cempreng lagi!
      audioFilters.push('loudnorm=I=-14:LRA=11:TP=-1.0');

      let filterString = audioFilters.length > 0 ? audioFilters.join(',') : 'anull';

      // ---------------------------------------------------------
      // TAHAP 1: TERAPKAN SEMUA FILTER (PITCH, TEMPO, WOBBLE, LOUDNORM)
      // ---------------------------------------------------------
      self.postMessage({ status: 'processing', text: "Tahap 1: Menerapkan Filter Audio (Lo-Fi Mode)...", progress: 30 });
      try {
        let res1 = await ffmpeg.exec(['-i', 'input.wav', '-af', filterString, 'temp1.wav']);
        if (res1 !== 0) throw new Error("Exit code: " + res1);
        await ffmpeg.deleteFile('input.wav'); 
      } catch (e) {
        throw new Error("Crash Tahap 1. LOG: " + lastLog);
      }

      // ---------------------------------------------------------
      // TAHAP 2: INJECT SUB-AUDIO & ENCODE MP3
      // ---------------------------------------------------------
      self.postMessage({ status: 'processing', text: "Tahap Akhir: Encoding MP3 Final...", progress: 70 });
      try {
        // Menggunakan bitrate 128k sengaja agar frekuensi atas sedikit terpotong (Suno makin susah deteksi)
        let bitrate = settings.mp3Bitrate || '128'; 
        let vbrFlag = settings.vbrMode ? ['-q:a', '2'] : ['-b:a', `${bitrate}k`];
        let subAudioGain = settings.subAudioGain || '-50'; 
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

      self.postMessage({ status: 'processing', text: "Menyelesaikan file MP3...", progress: 95 });
      
      const data = await ffmpeg.readFile('output.mp3');
      await ffmpeg.deleteFile('output.mp3');
      
      self.postMessage({ status: 'done', resultBuffer: data.buffer, progress: 100 }, [data.buffer]);
      
    } catch (error) {
      self.postMessage({ status: 'error', text: error.message || String(error), progress: 0 });
    }
  }
};