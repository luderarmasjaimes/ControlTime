import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Mic, MicOff, Loader2, Volume2, VolumeX, Globe, AlertCircle,
  CheckCircle2, RotateCcw, Pause, Play, Settings,
} from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────────────
   VOICE DICTATION ENGINE — Dictado por voz con Whisper/Web Speech API
   FX07 + AI14: Dictado voz→lienzo integrado al Ribbon
   Soporta vocabulario técnico minero, inserción en cursor
   ───────────────────────────────────────────────────────────────────────── */

const MINING_REPLACEMENTS = [
  [/\bton por hora\b/gi, 'TPH'],
  [/\btoneladas por hora\b/gi, 'TPH'],
  [/\bmetraje perforado\b/gi, 'metraje perforado (m)'],
  [/\bley de cobre\b/gi, 'ley Cu (%)'],
  [/\bley de oro\b/gi, 'ley Au (g/t)'],
  [/\bppm\b/gi, 'ppm'],
  [/\bpie cuadrado\b/gi, 'ft²'],
  [/\bmetro cubico\b/gi, 'm³'],
  [/\bmetros cubicos\b/gi, 'm³'],
  [/\bkilogramo por metro cuadrado\b/gi, 'kg/m²'],
  [/\bfactor de seguridad\b/gi, 'F.S.'],
  [/\bresistencia a la compresion\b/gi, 'UCS (MPa)'],
  [/\bangulo de friccion\b/gi, 'φ (°)'],
];

function applyMiningVocab(text) {
  let result = text;
  MINING_REPLACEMENTS.forEach(([pattern, replacement]) => {
    result = result.replace(pattern, replacement);
  });
  return result;
}

function normalizePunctuation(text) {
  return text
    .replace(/\s+punto y coma\s+/gi, '; ')
    .replace(/\s+dos puntos\s+/gi, ': ')
    .replace(/\s+nueva linea\s+/gi, '\n')
    .replace(/\s+nueva línea\s+/gi, '\n')
    .replace(/\s+salto de linea\s+/gi, '\n')
    .replace(/\s+abrir parentesis\s+/gi, ' (')
    .replace(/\s+abrir paréntesis\s+/gi, ' (')
    .replace(/\s+cerrar parentesis\s+/gi, ') ')
    .replace(/\s+cerrar paréntesis\s+/gi, ') ')
    .replace(/\s+coma\s+/gi, ', ')
    .replace(/\s+punto\s+/gi, '. ')
    .replace(/\s+([,.;:!?])/g, '$1');
}

export default function VoiceDictation({
  onInsertText,
  onTranscriptUpdate,
  compact = false,
  language = 'es-PE',
}) {
  const [isListening, setIsListening] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState(null);
  const [confidence, setConfidence] = useState(0);
  const [mode, setMode] = useState('webspeech'); // webspeech | whisper
  const [showSettings, setShowSettings] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const recognitionRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const animFrameRef = useRef(null);

  const getSpeechCtor = () => {
    if (typeof window === 'undefined') return null;
    return window.SpeechRecognition || window.webkitSpeechRecognition;
  };

  const startAudioLevel = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      audioContextRef.current = ctx;
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setAudioLevel(Math.min(100, avg * 1.5));
        animFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* silently fail */ }
  }, []);

  const stopAudioLevel = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
    if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop());
  }, []);

  const startListening = useCallback(() => {
    setError(null);
    const SpeechRecognition = getSpeechCtor();
    if (!SpeechRecognition) {
      setError('Web Speech API no soportada en este navegador.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = language;
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 3;

    recognition.onresult = (event) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          final += text;
          setConfidence(Math.round(result[0].confidence * 100));
        } else {
          interim += text;
        }
      }
      if (final) {
        const processed = applyMiningVocab(normalizePunctuation(final));
        setTranscript(prev => prev + processed);
        onTranscriptUpdate?.(processed);
      }
      setInterimTranscript(interim);
    };

    recognition.onerror = (event) => {
      if (event.error === 'no-speech') return;
      setError(`Error: ${event.error}`);
      setIsListening(false);
    };

    recognition.onend = () => {
      if (isListening && !isPaused) {
        try { recognition.start(); } catch { setIsListening(false); }
      }
    };

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
    setIsPaused(false);
    startAudioLevel();
  }, [language, isListening, isPaused, onTranscriptUpdate, startAudioLevel]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setIsPaused(false);
    setInterimTranscript('');
    stopAudioLevel();
  }, [stopAudioLevel]);

  const pauseListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
    }
    setIsPaused(true);
    stopAudioLevel();
  }, [stopAudioLevel]);

  const resumeListening = useCallback(() => {
    const SpeechRecognition = getSpeechCtor();
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = language;
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 3;
    recognition.onresult = recognitionRef.current?.onresult;
    recognition.onerror = recognitionRef.current?.onerror;
    recognition.start();
    recognitionRef.current = recognition;
    setIsPaused(false);
    startAudioLevel();
  }, [language, startAudioLevel]);

  const insertAndClear = useCallback(() => {
    if (transcript.trim()) {
      onInsertText?.(transcript.trim());
      setTranscript('');
      setInterimTranscript('');
    }
  }, [transcript, onInsertText]);

  useEffect(() => {
    return () => { stopListening(); };
  }, []);

  if (compact) {
    return (
      <button
        type="button"
        className={`vd-compact-btn ${isListening ? 'vd-compact-btn--active' : ''}`}
        onClick={isListening ? stopListening : startListening}
        title={isListening ? 'Detener dictado' : 'Iniciar dictado por voz'}
      >
        {isListening ? <MicOff size={14} /> : <Mic size={14} />}
        {isListening && <span className="vd-pulse-dot" />}
      </button>
    );
  }

  return (
    <div className={`vd-panel ${isListening ? 'vd-panel--active' : ''}`}>
      <div className="vd-header">
        <Mic size={14} />
        <span>Dictado por Voz</span>
        <span className="vd-lang-badge">{language}</span>
        <button type="button" className="vd-settings-btn" onClick={() => setShowSettings(v => !v)}>
          <Settings size={12} />
        </button>
      </div>

      {showSettings && (
        <div className="vd-settings">
          <label>Idioma:
            <select value={language} disabled>
              <option value="es-PE">Español (Perú)</option>
              <option value="es-CL">Español (Chile)</option>
              <option value="es-MX">Español (México)</option>
              <option value="en-US">English (US)</option>
            </select>
          </label>
        </div>
      )}

      <div className="vd-controls">
        {!isListening ? (
          <button type="button" className="vd-main-btn vd-main-btn--start" onClick={startListening}>
            <Mic size={20} /> Iniciar dictado
          </button>
        ) : (
          <div className="vd-active-controls">
            {isPaused ? (
              <button type="button" className="vd-ctrl-btn vd-ctrl-btn--resume" onClick={resumeListening}>
                <Play size={14} /> Reanudar
              </button>
            ) : (
              <button type="button" className="vd-ctrl-btn vd-ctrl-btn--pause" onClick={pauseListening}>
                <Pause size={14} /> Pausar
              </button>
            )}
            <button type="button" className="vd-ctrl-btn vd-ctrl-btn--stop" onClick={stopListening}>
              <MicOff size={14} /> Detener
            </button>
          </div>
        )}
      </div>

      {isListening && !isPaused && (
        <div className="vd-level">
          <div className="vd-level-bar">
            <div className="vd-level-fill" style={{ width: `${audioLevel}%` }} />
          </div>
          <span className="vd-level-label">Nivel audio</span>
        </div>
      )}

      {(transcript || interimTranscript) && (
        <div className="vd-transcript">
          <div className="vd-transcript-text">
            {transcript}
            {interimTranscript && <span className="vd-interim">{interimTranscript}</span>}
          </div>
          {confidence > 0 && <span className="vd-confidence">Confianza: {confidence}%</span>}
        </div>
      )}

      {transcript && (
        <div className="vd-actions">
          <button type="button" className="alarm-btn alarm-btn--ack" onClick={insertAndClear}>
            <CheckCircle2 size={14} /> Insertar en documento
          </button>
          <button type="button" className="alarm-btn alarm-btn--report" onClick={() => { setTranscript(''); setInterimTranscript(''); }}>
            <RotateCcw size={14} /> Limpiar
          </button>
        </div>
      )}

      {error && (
        <div className="vd-error">
          <AlertCircle size={12} /> {error}
        </div>
      )}
    </div>
  );
}
