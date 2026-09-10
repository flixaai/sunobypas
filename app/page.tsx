'use client';
import React, { useState, useRef, useEffect } from 'react';
import { Upload, Settings2, Check, Music, AudioWaveform, Sliders } from 'lucide-react';

export default function AudioAnonymizer() {
  const [file, setFile] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState('Anonymize it!');
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(true);
  const workerRef = useRef(null);

  // STATE: SEMUA FITUR DI GAMBAR
  const [settings, setSettings] = useState({
    preset: 'Moderate',
    instrumentalOnly: 'Off',
    isInstrumentalSong: false,
    pitch: '-3.5',
    tempo: '102',
    sampleRate: '',
    eqNotch: '',
    reverbWet: '0',
    silencePad: '0',
    normalize: true,
    autoDetectVocals: true,
    lyricBypass: true,
    mp3Bitrate: '192',
    eqTiltMax: '0',
    eqTiltBands: '0',
    fullMixPitchJitter: '0',
    jitterLFO: '0',
    sideChannelJitter: '0',
    sideChannelLFO: '0',
    peakSmearBands: '0',
    peakSmearDepth: '0',
    peakSmearLFO: '0',
    subAudioInject: '0',
    subAudioGain: '-60',
    vbrMode: true
  });

  useEffect(() => {
    workerRef.current = new Worker('/worker.js', { type: 'module' });
    workerRef.current.onmessage = (event) => {
      const { status, text, resultBuffer } = event.data;
      if (status === 'loading' || status === 'processing') {
        setStatusText(text);
      } else if (status === 'done') {
        const blob = new Blob([resultBuffer], { type: 'audio/wav' });
        setDownloadUrl(URL.createObjectURL(blob));
        setIsProcessing(false);
        setStatusText('Download Ready!');
      } else if (status === 'error') {
        alert('Proses Gagal: ' + text);
        setIsProcessing(false);
        setStatusText('Anonymize it!');
      }
    };
    return () => workerRef.current?.terminate();
  }, []);

  const handleProcess = () => {
    if (!file) return alert('Silakan upload file audio terlebih dahulu.');
    setIsProcessing(true);
    setDownloadUrl(null);
    workerRef.current.postMessage({ action: 'PROCESS', audioFile: file, settings });
  };

  const handleSet = (key, val) => setSettings(p => ({ ...p, [key]: val }));

  return (
    <div className="min-h-screen bg-[#f4f4f0] p-4 md:p-8 font-sans text-gray-800">
      <div className="mx-auto max-w-4xl bg-[#eeebe5] rounded-xl shadow-lg border border-gray-300 p-6 md:p-8">
        
        {/* HEADER */}
        <div className="flex items-center gap-2 mb-2">
          <AudioWaveform className="w-6 h-6 text-gray-700" />
          <h1 className="text-2xl font-bold">Audio Anonymizer</h1>
        </div>
        <p className="text-sm text-gray-600 mb-6">Upload any audio to Suno. Optimize audio so it passes Suno's check for known audio works and can be used to create new songs.</p>

        {/* UPLOADER */}
        <label className="border-2 border-dashed border-gray-400 bg-white rounded-lg p-10 flex flex-col items-center justify-center mb-6 cursor-pointer hover:bg-gray-50 transition relative">
          <input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files[0])} className="absolute inset-0 opacity-0 cursor-pointer" />
          <Upload className="w-8 h-8 text-gray-500 mb-3" />
          <p className="font-bold text-gray-700">{file ? `✅ ${file.name}` : 'Drop your audio here or click to browse'}</p>
          <p className="text-xs text-gray-400 mt-1">MP3, WAV, OGG, FLAC, M4A, AAC, WebM</p>
        </label>

        {/* PRESET */}
        <div className="mb-4">
          <p className="text-xs font-bold text-gray-500 mb-2">PRESET</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {['Subtle', 'Moderate', 'Aggressive', 'Instrumental'].map((p) => (
              <button key={p} onClick={() => handleSet('preset', p)} className={`py-2 text-sm font-medium border rounded transition-all ${settings.preset === p ? 'bg-green-100 border-green-600 text-green-800' : 'bg-white text-gray-600 border-gray-300'}`}>{p}</button>
            ))}
          </div>
        </div>

        {/* GLOBAL INSTRUMENTAL CHECKBOX */}
        <label className="flex items-start gap-3 p-4 bg-white border border-gray-200 rounded-md mb-6 cursor-pointer">
          <input type="checkbox" checked={settings.isInstrumentalSong} onChange={e => handleSet('isInstrumentalSong', e.target.checked)} className="mt-1 w-4 h-4 text-green-600" />
          <div>
            <p className="text-sm font-medium">This song is instrumental (no vocals)</p>
            <p className="text-xs text-gray-500 mt-1">Skips vocal detection and the lyric-detection bypass...</p>
          </div>
        </label>

        {/* ADVANCED SETTINGS */}
        <div className="border border-gray-300 rounded-md bg-[#fdfdfb] mb-6">
          <button onClick={() => setIsAdvancedOpen(!isAdvancedOpen)} className="w-full flex items-center justify-between p-4 bg-gray-100 hover:bg-gray-200 transition rounded-t-md font-bold">
            <span className="flex items-center gap-2"><Settings2 className="w-4 h-4"/> Advanced settings</span>
            <span>{isAdvancedOpen ? '▲' : '▼'}</span>
          </button>
          
          {isAdvancedOpen && (
            <div className="p-4 border-t border-gray-200 space-y-4">
              {/* Instrumental Level */}
              <div>
                 <p className="text-xs font-bold text-gray-600 mb-1">Instrumental only</p>
                 <div className="flex bg-gray-100 p-1 rounded border">
                    {['Off', 'Light', 'Hard'].map(l => (
                      <button key={l} onClick={() => handleSet('instrumentalOnly', l)} className={`flex-1 text-sm py-1 rounded ${settings.instrumentalOnly === l ? 'bg-white shadow border font-bold text-green-700' : 'text-gray-500'}`}>{l}</button>
                    ))}
                 </div>
              </div>

              {/* Grid 1: Basic DSP */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-gray-600">Pitch (semitones)</label>
                  <input type="text" value={settings.pitch} onChange={e => handleSet('pitch', e.target.value)} className="w-full border p-2 text-sm mt-1 bg-white" />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-600">Tempo (%, 100 = unchanged)</label>
                  <input type="text" value={settings.tempo} onChange={e => handleSet('tempo', e.target.value)} className="w-full border p-2 text-sm mt-1 bg-white" />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-600">Sample rate (Hz)</label>
                  <input type="text" value={settings.sampleRate} onChange={e => handleSet('sampleRate', e.target.value)} className="w-full border p-2 text-sm mt-1 bg-white" />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-600">EQ notch (Hz)</label>
                  <input type="text" value={settings.eqNotch} onChange={e => handleSet('eqNotch', e.target.value)} className="w-full border p-2 text-sm mt-1 bg-white" />
                </div>
              </div>

              {/* Checkboxes AI & Bypass */}
              <div className="space-y-3 py-3 border-y border-gray-200">
                <label className="flex items-center gap-2"><input type="checkbox" checked={settings.normalize} onChange={e => handleSet('normalize', e.target.checked)} /> <span className="text-sm">Normalize peak to 1.0</span></label>
                <label className="flex items-start gap-2"><input type="checkbox" checked={settings.autoDetectVocals} onChange={e => handleSet('autoDetectVocals', e.target.checked)} className="mt-1"/> <div><span className="text-sm">Auto-detect vocals before lyric bypass</span><p className="text-[10px] text-gray-500">Runs a fast built-in detector...</p></div></label>
                <label className="flex items-start gap-2"><input type="checkbox" checked={settings.lyricBypass} onChange={e => handleSet('lyricBypass', e.target.checked)} className="mt-1"/> <div><span className="text-sm">Lyric-detection bypass (vocal stem mangle)</span><p className="text-[10px] text-gray-500">Downloads a ~300 MB separation model...</p></div></label>
              </div>

              {/* Grid 2: Advanced Math DSP (Jitter, Smear, EQ Tilt) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 {/* MP3 VBR */}
                 <div><label className="text-xs font-bold text-gray-600">MP3 round-trip bitrate</label><input type="text" value={settings.mp3Bitrate} onChange={e => handleSet('mp3Bitrate', e.target.value)} className="w-full border p-2 text-sm mt-1 bg-white" /></div>
                 <div><label className="text-xs font-bold text-gray-600">EQ tilt max ±dB</label><input type="text" value={settings.eqTiltMax} onChange={e => handleSet('eqTiltMax', e.target.value)} className="w-full border p-2 text-sm mt-1 bg-white" /></div>
                 
                 <div><label className="text-xs font-bold text-gray-600">Jitter LFO (Hz)</label><input type="text" value={settings.jitterLFO} onChange={e => handleSet('jitterLFO', e.target.value)} className="w-full border p-2 text-sm mt-1 bg-white" /></div>
                 <div><label className="text-xs font-bold text-gray-600">Side-channel jitter (cents)</label><input type="text" value={settings.sideChannelJitter} onChange={e => handleSet('sideChannelJitter', e.target.value)} className="w-full border p-2 text-sm mt-1 bg-white" /></div>
                 
                 <div><label className="text-xs font-bold text-gray-600">Peak smear depth (dB)</label><input type="text" value={settings.peakSmearDepth} onChange={e => handleSet('peakSmearDepth', e.target.value)} className="w-full border p-2 text-sm mt-1 bg-white" /></div>
                 <div><label className="text-xs font-bold text-gray-600">Sub-audio inject (Hz)</label><input type="text" value={settings.subAudioInject} onChange={e => handleSet('subAudioInject', e.target.value)} className="w-full border p-2 text-sm mt-1 bg-white" /></div>
              </div>
              
              <label className="flex items-center gap-2"><input type="checkbox" checked={settings.vbrMode} onChange={e => handleSet('vbrMode', e.target.checked)} /> <span className="text-sm font-bold text-gray-700">MP3 round-trip: VBR mode</span></label>
            </div>
          )}
        </div>

        {/* EKSEKUSI */}
        {!downloadUrl ? (
          <button onClick={handleProcess} disabled={isProcessing} className={`w-full py-4 rounded-md text-lg font-bold border-2 transition-all ${isProcessing ? 'bg-gray-400 border-gray-500 text-white shadow-none translate-y-1' : 'bg-[#76b09c] border-[#3f6758] text-white shadow-[4px_4px_0px_#3f6758] hover:-translate-y-1 active:translate-y-[4px] active:shadow-none'}`}>
            {statusText}
          </button>
        ) : (
          <div className="bg-green-100 border-2 border-green-600 p-6 rounded-md text-center">
            <h3 className="font-bold text-green-800 text-xl mb-4">✅ Anonymization Complete (100%)</h3>
            <a href={downloadUrl} download={`Suno_Bypass_${file?.name || 'audio'}.wav`} className="inline-block px-8 py-3 bg-[#76b09c] text-white font-bold rounded-md shadow-[4px_4px_0px_#3f6758]">Download Now</a>
            <button onClick={() => {setDownloadUrl(null); setFile(null);}} className="block mx-auto mt-4 text-sm font-bold text-gray-600 underline">Anonymize again</button>
          </div>
        )}
      </div>
    </div>
  );
}