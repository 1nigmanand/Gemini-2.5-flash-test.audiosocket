import { useState, useRef, useEffect } from 'react';
import { floatTo16BitPCM, arrayBufferToBase64, base64ToArrayBuffer, playAudioData } from './audioUtils';
import './App.css';

const GEMINI_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';
const SAMPLE_RATE = 24000;

// --- Components ---

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('System Offline');
  const [error, setError] = useState('');
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [latency, setLatency] = useState(0);
  const [userTranscript, setUserTranscript] = useState('');
  const [logs, setLogs] = useState([]);
  const [sessionTime, setSessionTime] = useState(0);
  
  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);
  const nextStartTimeRef = useRef(0);
  const isSpacePressedRef = useRef(false);
  const requestStartTimeRef = useRef(null);
  const audioBufferRef = useRef([]);
  const isRecordingRef = useRef(false);
  const recognitionRef = useRef(null);
  const timerRef = useRef(null);

  const addLog = (message) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [`[${time}] ${message}`, ...prev].slice(0, 50));
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, []);

  // Session Timer
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setSessionTime(prev => prev + 1);
      }, 1000);
    } else {
      clearInterval(timerRef.current);
      setSessionTime(0);
    }
    return () => clearInterval(timerRef.current);
  }, [isRecording]);

  // Handle spacebar press
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space' && !e.repeat && !isSpacePressedRef.current && isRecording) {
        e.preventDefault();
        isSpacePressedRef.current = true;
        setIsSpacePressed(true);
        setStatus('Listening...');
        addLog('Microphone active - Listening');
        
        // Start speech recognition
        if (recognitionRef.current) {
          try {
            recognitionRef.current.start();
            setUserTranscript(''); 
          } catch (e) {
            // Ignore if already started
          }
        }
      }
    };

    const handleKeyUp = (e) => {
      if (e.code === 'Space' && isSpacePressedRef.current && isRecording) {
        e.preventDefault();
        isSpacePressedRef.current = false;
        setIsSpacePressed(false);
        
        // Stop speech recognition
        if (recognitionRef.current) {
          try {
            recognitionRef.current.stop();
          } catch (e) {
            // Ignore
          }
        }
        
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && audioBufferRef.current.length > 0) {
          setStatus('Processing...');
          addLog('Processing audio buffer...');
          
          const totalLength = audioBufferRef.current.reduce((sum, arr) => sum + arr.length, 0);
          const combinedAudio = new Float32Array(totalLength);
          let offset = 0;
          for (const chunk of audioBufferRef.current) {
            combinedAudio.set(chunk, offset);
            offset += chunk.length;
          }
          
          const pcm16 = floatTo16BitPCM(combinedAudio);
          const base64Audio = arrayBufferToBase64(pcm16);
          
          requestStartTimeRef.current = performance.now();
          wsRef.current.send(JSON.stringify({
            realtimeInput: {
              mediaChunks: [{
                mimeType: 'audio/pcm',
                data: base64Audio
              }]
            }
          }));
          
          audioBufferRef.current = [];
          setStatus('Waiting for response...');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isRecording]);

  const startRecording = async () => {
    if (isRecordingRef.current) return;

    setIsRecording(true);
    isRecordingRef.current = true;
    addLog('Initializing system...');

    try {
      setError('');
      setStatus('Requesting Access');
      setLatency(0);
      setUserTranscript('');

      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey) throw new Error('VITE_GEMINI_API_KEY not found');

      // Initialize Speech Recognition
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        
        recognition.onresult = (event) => {
          let interimTranscript = '';
          let finalTranscript = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            } else {
              interimTranscript += event.results[i][0].transcript;
            }
          }
          
          if (interimTranscript || finalTranscript) {
             setUserTranscript(finalTranscript + interimTranscript);
          }
        };
        
        recognitionRef.current = recognition;
      }

      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: SAMPLE_RATE
      });
      
      nextStartTimeRef.current = 0;
      audioBufferRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true
        } 
      });

      if (!isRecordingRef.current) {
        stream.getTracks().forEach(track => track.stop());
        if (audioContextRef.current) audioContextRef.current.close();
        return;
      }

      mediaStreamRef.current = stream;
      setStatus('Connecting...');
      addLog('Connecting to Gemini WebSocket...');

      const ws = new WebSocket(
        `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`
      );
      
      wsRef.current = ws;

      ws.onopen = async () => {
        if (!isRecordingRef.current) {
           ws.close();
           return;
        }
        
        setStatus('System Online');
        addLog('Connection established');
        
        if (audioContextRef.current?.state === 'suspended') {
          await audioContextRef.current.resume();
        }

        ws.send(JSON.stringify({
          setup: {
            model: `models/${GEMINI_MODEL}`,
            generationConfig: {
              responseModalities: "AUDIO",
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: "Puck"
                  }
                }
              }
            }
          }
        }));

        try {
          const source = audioContextRef.current.createMediaStreamSource(stream);
          sourceRef.current = source;

          const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
          processorRef.current = processor;

          processor.onaudioprocess = (e) => {
            if (ws.readyState === WebSocket.OPEN && isSpacePressedRef.current) {
              const inputData = e.inputBuffer.getChannelData(0);
              audioBufferRef.current.push(new Float32Array(inputData));
            }
          };

          source.connect(processor);
          processor.connect(audioContextRef.current.destination);
        } catch (e) {
          console.error("Audio graph setup failed", e);
          addLog(`Error: ${e.message}`);
          stopRecording();
        }
      };

      ws.onmessage = async (event) => {
        try {
          if (!isRecordingRef.current) return;

          let data = event.data;
          if (data instanceof Blob) data = await data.text();
          
          const response = JSON.parse(data);
          
          if (response.setupComplete) {
            addLog('Setup complete. Ready.');
            return;
          }

          if (response.serverContent?.modelTurn?.parts) {
            if (requestStartTimeRef.current) {
              const latencyMs = performance.now() - requestStartTimeRef.current;
              setLatency(Math.round(latencyMs));
              requestStartTimeRef.current = null;
            }

            const parts = response.serverContent.modelTurn.parts;
            for (const part of parts) {
              if (part.inlineData?.data) {
                if (!audioContextRef.current) return;

                const audioData = base64ToArrayBuffer(part.inlineData.data);
                const { duration, playTime } = await playAudioData(
                  audioContextRef.current, 
                  audioData, 
                  nextStartTimeRef.current
                );
                nextStartTimeRef.current = playTime + duration;
                setStatus('Receiving Audio');
                addLog('Receiving audio stream...');
              }
            }
          }

          if (response.serverContent?.turnComplete) {
            setStatus('Turn Complete');
            addLog('Turn complete. Waiting for input.');
          }

        } catch (err) {
          console.error('Error processing message:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        setError('Connection error');
        addLog('WebSocket Error occurred');
        stopRecording();
      };

      ws.onclose = () => {
        if (isRecordingRef.current) {
           setStatus('Disconnected');
           addLog('Connection closed');
           stopRecording();
        }
      };

    } catch (err) {
      console.error('Error starting recording:', err);
      setError(err.message || 'Failed to start');
      addLog(`Error: ${err.message}`);
      stopRecording();
    }
  };

  const stopRecording = () => {
    setIsRecording(false);
    isRecordingRef.current = false;
    setStatus('System Offline');
    setIsSpacePressed(false);
    isSpacePressedRef.current = false;
    audioBufferRef.current = [];
    addLog('System shutdown initiated');

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        // Ignore
      }
      recognitionRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (e) {
        console.error("Error closing audio context", e);
      }
      audioContextRef.current = null;
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="console-container">
      <div className="console-header">
        <div className="header-title">
          <span className="status-dot-header"></span>
          <h1>GEMINI LIVE CONSOLE</h1>
        </div>
        <div className="header-meta">
          <span>V 2.5.0</span>
          <span>SECURE LINK</span>
        </div>
      </div>

      <div className="console-grid">
        {/* Left Column: Status & Metrics */}
        <div className="panel status-panel">
          <div className="panel-header">SYSTEM STATUS</div>
          <div className="panel-content">
            <div className="metric-row">
              <span className="label">STATE</span>
              <span className={`value ${isRecording ? 'active' : 'inactive'}`}>
                {isRecording ? 'ONLINE' : 'OFFLINE'}
              </span>
            </div>
            <div className="metric-row">
              <span className="label">MODE</span>
              <span className="value">VOICE/AUDIO</span>
            </div>
            <div className="metric-row">
              <span className="label">LATENCY</span>
              <span className="value">{latency}ms</span>
            </div>
            <div className="metric-row">
              <span className="label">SESSION</span>
              <span className="value">{formatTime(sessionTime)}</span>
            </div>
            <div className="metric-row">
              <span className="label">BUFFER</span>
              <span className="value">{audioBufferRef.current.length} chunks</span>
            </div>
          </div>
        </div>

        {/* Center Column: Visualizer & Transcript */}
        <div className="panel main-panel">
          <div className="visualizer-section">
            <div className={`visualizer-ring ${isSpacePressed ? 'active' : ''}`}></div>
            <div className={`visualizer-ring delay-1 ${isSpacePressed ? 'active' : ''}`}></div>
            <div className="mic-center">
              {isRecording ? (
                <span className="mic-icon">🎙️</span>
              ) : (
                <span className="mic-icon">⛔</span>
              )}
            </div>
            <div className="status-overlay">{status.toUpperCase()}</div>
          </div>
          
          <div className="transcript-section">
            <div className="panel-header">LIVE TRANSCRIPT</div>
            <div className="transcript-content">
              {userTranscript || <span className="placeholder">Waiting for input...</span>}
            </div>
          </div>
        </div>

        {/* Right Column: Controls & Logs */}
        <div className="panel right-panel">
          <div className="controls-section">
            <div className="panel-header">CONTROLS</div>
            <button 
              className={`console-btn ${isRecording ? 'stop' : 'start'}`}
              onClick={isRecording ? stopRecording : startRecording}
            >
              {isRecording ? 'TERMINATE SESSION' : 'INITIALIZE SYSTEM'}
            </button>
            <div className="instruction-box">
              <span className="key">SPACE</span>
              <span className="desc">HOLD TO TALK</span>
            </div>
          </div>

          <div className="logs-section">
            <div className="panel-header">SYSTEM LOGS</div>
            <div className="logs-content">
              {logs.map((log, i) => (
                <div key={i} className="log-entry">{log}</div>
              ))}
              {logs.length === 0 && <div className="log-entry">System ready...</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
