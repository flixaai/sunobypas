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
      // MERACIK FILTER (JERNIH, BASS UTUH, AMAN DARI CRASH)
      // =====================================================================
      let audioFilters = [];

      // 1. SILENCE PAD (Geser waktu awal lagu)
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

      // 3. STEALTH BYPASS (Efek Studio Halus - Tidak Merusak Suara)
      if (settings.lyricBypass && !settings.isInstrumentalSong) {
          // Phaser & Chorus sangat tipis. Terdengar seperti efek stereo widening.
          // Melodi & Cengkok 100% aman, tapi bot copyright akan buta.
          audioFilters.push(`aphaser=type=t:speed=0.2:decay=0.2`);
          audioFilters.push(`chorus=0.7:0.9:40:0.4:0.1:2:t=s`);
      }

      // 4. LOUDNORM (Kembalikan Bass & Volume agar keras seperti asli)
      audioFilters.push('loudnorm=I=-14:LRA=11:TP=-1.0');

      // Gabungkan semua filter menjadi 1 baris lurus (Anti-Crash)
      let filterString = audioFilters.length > 0 ? audioFilters.join(',') : 'anull';

      // ---------------------------------------------------------
      // EKSEKUSI LANGSUNG KE MP3 (Satu Tahap, Hemat RAM)
      // ---------------------------------------------------------
      self.postMessage({ status: 'processing', text: "Menerapkan Filter & Encoding MP3...", progress: 30 });
      try {
        let bitrate = settings.mp3Bitrate || '192'; 
        let vbrFlag = settings.vbrMode ? ['-q:a', '0'] : ['-b:a', `${bitrate}k`];
        
        // Eksekusi 1 baris langsung jadi MP3
        let res = await ffmpeg.exec(['-i', 'input.wav', '-af', filterString, ...vbrFlag, '-ar', settings.sampleRate || '44100', 'output.mp3']);
        
        if (res !== 0) throw new Error("Exit code: " + res);
        await ffmpeg.deleteFile('input.wav'); 
      } catch (e) {
        throw new Error("Crash saat memproses. LOG: " + lastLog);
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