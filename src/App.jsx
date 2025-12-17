import { useState, useRef, useEffect } from 'react';
import { floatTo16BitPCM, arrayBufferToBase64, base64ToArrayBuffer, playAudioData } from './audioUtils';
import './App.css';

const GEMINI_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';
const SAMPLE_RATE = 24000;

// --- Components ---

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('Ready to start');
  const [error, setError] = useState('');
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [latency, setLatency] = useState(null);
  const [userTranscript, setUserTranscript] = useState('');
  
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, []);

  // Handle spacebar press
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space' && !e.repeat && !isSpacePressedRef.current && isRecording) {
        e.preventDefault();
        isSpacePressedRef.current = true;
        setIsSpacePressed(true);
        setStatus('Listening...');
        
        // Start speech recognition
        if (recognitionRef.current) {
          try {
            recognitionRef.current.start();
            setUserTranscript(''); // Clear previous transcript
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

    // Set state immediately to prevent race conditions and double-clicks
    setIsRecording(true);
    isRecordingRef.current = true;

    try {
      setError('');
      setStatus('Requesting microphone access...');
      setLatency(null);
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

      // Create AudioContext
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: SAMPLE_RATE
      });
      
      nextStartTimeRef.current = 0;
      audioBufferRef.current = [];

      // Get Media Stream
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true
        } 
      });

      // Check if user cancelled while waiting for permission
      if (!isRecordingRef.current) {
        stream.getTracks().forEach(track => track.stop());
        if (audioContextRef.current) audioContextRef.current.close();
        return;
      }

      mediaStreamRef.current = stream;
      setStatus('Connecting...');

      const ws = new WebSocket(
        `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`
      );
      
      wsRef.current = ws;

      ws.onopen = async () => {
        if (!isRecordingRef.current) {
           ws.close();
           return;
        }
        
        setStatus('Connected! Hold Space to speak');
        
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
          stopRecording();
        }
      };

      ws.onmessage = async (event) => {
        try {
          if (!isRecordingRef.current) return;

          let data = event.data;
          if (data instanceof Blob) data = await data.text();
          
          const response = JSON.parse(data);
          
          if (response.setupComplete) return;

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
                setStatus('Speaking...');
              }
            }
          }

          if (response.serverContent?.turnComplete) {
            setStatus('Reply finished. Your turn.');
          }

        } catch (err) {
          console.error('Error processing message:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        setError('Connection error');
        stopRecording();
      };

      ws.onclose = () => {
        if (isRecordingRef.current) {
           setStatus('Disconnected');
           stopRecording();
        }
      };

    } catch (err) {
      console.error('Error starting recording:', err);
      setError(err.message || 'Failed to start');
      stopRecording();
    }
  };

  const stopRecording = () => {
    setIsRecording(false);
    isRecordingRef.current = false;
    setStatus('Stopped');
    setIsSpacePressed(false);
    isSpacePressedRef.current = false;
    audioBufferRef.current = [];

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

  return (
    <div className="app-container">
      <div className="main-card">
        <div className="header">
          <h1>Gemini Live</h1>
          <div className={`connection-badge ${isRecording ? 'connected' : ''}`}>
            {isRecording ? 'Connected' : 'Offline'}
          </div>
        </div>

        <div className={`visualizer-container ${isSpacePressed ? 'active' : ''}`}>
          <div className="pulse-ring"></div>
          <div className="mic-icon">
            {isRecording ? '🎙️' : '🔇'}
          </div>
        </div>

        <div className="status-area">
          <p className="status-text">{error || status}</p>
          {latency && <span className="latency-tag">⚡ {latency}ms</span>}
        </div>

        {userTranscript && (
          <div className="transcript-box">
            <p className="transcript-text">"{userTranscript}"</p>
          </div>
        )}

        <div className="controls">
          <button 
            className={`primary-btn ${isRecording ? 'active' : ''}`}
            onClick={isRecording ? stopRecording : startRecording}
          >
            {isRecording ? 'End Session' : 'Start Conversation'}
          </button>
          <p className="hint-text">Hold <kbd>Space</kbd> to speak</p>
        </div>
      </div>
    </div>
  );
}

export default App;
