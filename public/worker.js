import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

const ffmpeg = new FFmpeg();

self.onmessage = async (event) => {
  const { action, audioFile, settings } = event.data;

  if (action === 'PROCESS') {
    try {
      self.postMessage({ status: 'loading', text: 'Initiating DSP Engine...' });
      if (!ffmpeg.loaded) await ffmpeg.load();

      self.postMessage({ status: 'processing', text: 'Reading audio buffer...' });
      await ffmpeg.writeFile('input.wav', await fetchFile(audioFile));

      // MENGHITUNG RUMUS MATEMATIKA DSP (Bypass Algoritma)
      // 1. Kalkulasi Pitch & Tempo
      let pitchShift = parseFloat(settings.pitch.replace(',', '.')) || 0;
      let tempoPct = (parseFloat(settings.tempo) || 100) / 100;
      
      // Rumus Asetrate untuk pitch (Sangat merusak hashing Audio)
      let rateMultiplier = Math.pow(2, pitchShift / 12);
      let newSampleRate = 48000 * rateMultiplier;
      let atempoFix = tempoPct / rateMultiplier; // Kompensasi tempo akibat asetrate

      // 2. Persiapkan Filter Kompleks FFmpeg
      let audioFilters = [];
      
      // A. Pitch & Tempo Filter
      if (pitchShift !== 0 || tempoPct !== 1) {
        audioFilters.push(`asetrate=${newSampleRate},atempo=${atempoFix}`);
      }

      // B. Jitter & Smear (Simulasi dengan Chorus & Flanger mikro untuk merusak Peak Frequency Hash)
      if (parseFloat(settings.jitterLFO) > 0 || parseFloat(settings.peakSmearDepth) > 0) {
        let jitterHz = parseFloat(settings.jitterLFO) || 0.1;
        let smearDepth = parseFloat(settings.peakSmearDepth) || 1.0;
        // Mikro-chorus inaudible yang menghancurkan Phase-correlation di algoritma Suno
        audioFilters.push(`chorus=0.5:0.9:50:0.4:${jitterHz}:2:t=s`);
        audioFilters.push(`flanger=delay=${smearDepth}:depth=2:regen=0:width=71:speed=${parseFloat(settings.peakSmearLFO)||0.5}:phase=25`);
      }

      // C. Side-Channel Manipulation (M/S Jitter)
      if (parseFloat(settings.sideChannelJitter) > 0) {
         // Mengekstrak stereo, merusak channel samping (S), lalu menggabung lagi
         audioFilters.push('extrastereo=m=0.8:c=c');
      }

      // D. EQ Tilt / Notch 
      if (parseFloat(settings.eqTiltMax) !== 0) {
         let tilt = parseFloat(settings.eqTiltMax);
         audioFilters.push(`treble=g=${tilt},bass=g=${-tilt}`); // Simple tilt
      }
      if (settings.eqNotch && settings.eqNotch !== '') {
         audioFilters.push(`anequalizer=c0 f=${settings.eqNotch} w=100 g=-20`);
      }

      let filterString = audioFilters.length > 0 ? audioFilters.join(',') : 'anull';

      self.postMessage({ status: 'processing', text: 'Applying DSP Mangling & MP3 VBR Round-trip...' });
      
      // EKSEKUSI TAHAP 1: Mangle & Encode ke VBR MP3 (Menghapus high-end freq fingerprint)
      let bitrate = settings.mp3Bitrate || '192';
      let vbrFlag = settings.vbrMode ? ['-q:a', '0'] : ['-b:a', `${bitrate}k`]; // VBR Mode
      
      await ffmpeg.exec([
        '-i', 'input.wav', 
        '-af', filterString, // Masukkan semua rumus perusak sidik jari di atas
        ...vbrFlag,
        '-ar', settings.sampleRate || '48000', // Resample
        'temp.mp3'
      ]);

      // EKSEKUSI TAHAP 2: Sub-audio Inject & Decode balik ke WAV
      self.postMessage({ status: 'processing', text: 'Injecting Sub-audio DC Bias & Decoding...' });
      
      let subAudioGain = settings.subAudioGain || '-60';
      let subAudioFreq = parseFloat(settings.subAudioInject) || 0;
      
      if (subAudioFreq > 0) {
        // Menambahkan frekuensi sangat rendah (sub-bass) untuk menggeser energy floor
        await ffmpeg.exec([
          '-i', 'temp.mp3',
          '-f', 'lavfi', '-i', `sine=frequency=${subAudioFreq}:sample_rate=48000`,
          '-filter_complex', `[1:a]volume=${subAudioGain}dB[sub];[0:a][sub]amix=inputs=2:duration=first`,
          'output.wav'
        ]);
      } else {
        // Normal decode jika tidak ada sub audio
        await ffmpeg.exec(['-i', 'temp.mp3', 'output.wav']);
      }

      self.postMessage({ status: 'processing', text: 'Finalizing...' });
      const data = await ffmpeg.readFile('output.wav');

      self.postMessage({ status: 'done', resultBuffer: data.buffer }, [data.buffer]);

    } catch (error) {
      self.postMessage({ status: 'error', text: error.message });
    }
  }
};