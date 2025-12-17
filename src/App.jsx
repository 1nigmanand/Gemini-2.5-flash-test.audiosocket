import { useState, useRef, useEffect } from 'react';
import { floatTo16BitPCM, arrayBufferToBase64, base64ToArrayBuffer, playAudioData } from './audioUtils';
import './App.css';

const GEMINI_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';
const SAMPLE_RATE = 24000; // Match Gemini's audio output sample rate

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('Ready to start');
  const [error, setError] = useState('');
  
  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);
  const keepAliveIntervalRef = useRef(null);
  const nextStartTimeRef = useRef(0);
  
  // Voice activity detection
  const audioBufferRef = useRef([]);
  const isSpeakingRef = useRef(false);
  const silenceTimerRef = useRef(null);
  const SILENCE_THRESHOLD = 0.01; // Audio level threshold
  const SILENCE_DURATION = 1000; // 1 second of silence before sending

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, []);

  const startRecording = async () => {
    try {
      setError('');
      setStatus('Requesting microphone access...');

      // Check for API key
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('VITE_GEMINI_API_KEY not found. Please add it to your .env file');
      }

      // Initialize audio context
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: SAMPLE_RATE
      });
      
      nextStartTimeRef.current = 0;

      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true
        } 
      });
      mediaStreamRef.current = stream;

      setStatus('Connecting to Gemini...');

      // Connect to Gemini Live API via WebSocket
      const ws = new WebSocket(
        `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`
      );
      
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('Connected! Start speaking...');
        setIsRecording(true);

        // Send initial setup message with proper audio configuration
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

        // Set up audio processing
        const source = audioContextRef.current.createMediaStreamSource(stream);
        sourceRef.current = source;

        // Create ScriptProcessor for audio capture
        const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          if (ws.readyState === WebSocket.OPEN) {
            const inputData = e.inputBuffer.getChannelData(0);
            
            // Calculate audio level for voice activity detection
            const audioLevel = Math.sqrt(
              inputData.reduce((sum, sample) => sum + sample * sample, 0) / inputData.length
            );
            
            const isSpeaking = audioLevel > SILENCE_THRESHOLD;
            
            if (isSpeaking) {
              // User is speaking - buffer the audio
              if (!isSpeakingRef.current) {
                console.log('🎙️ Started speaking');
                setStatus('Listening...');
                isSpeakingRef.current = true;
              }
              
              // Clear any existing silence timer
              if (silenceTimerRef.current) {
                clearTimeout(silenceTimerRef.current);
                silenceTimerRef.current = null;
              }
              
              // Buffer the audio
              audioBufferRef.current.push(new Float32Array(inputData));
              
            } else if (isSpeakingRef.current) {
              // User was speaking but is now silent
              if (!silenceTimerRef.current) {
                // Start silence timer
                silenceTimerRef.current = setTimeout(() => {
                  console.log('🤫 Silence detected - sending audio');
                  setStatus('Processing...');
                  
                  // Concatenate all buffered audio
                  const totalLength = audioBufferRef.current.reduce((sum, arr) => sum + arr.length, 0);
                  const combinedAudio = new Float32Array(totalLength);
                  let offset = 0;
                  
                  for (const chunk of audioBufferRef.current) {
                    combinedAudio.set(chunk, offset);
                    offset += chunk.length;
                  }
                  
                  // Convert to PCM16 and send
                  const pcm16 = floatTo16BitPCM(combinedAudio);
                  const base64Audio = arrayBufferToBase64(pcm16);
                  
                  ws.send(JSON.stringify({
                    realtimeInput: {
                      mediaChunks: [{
                        mimeType: 'audio/pcm',
                        data: base64Audio
                      }]
                    }
                  }));
                  
                  // Clear the buffer and reset state
                  audioBufferRef.current = [];
                  isSpeakingRef.current = false;
                  silenceTimerRef.current = null;
                  setStatus('Waiting for response...');
                }, SILENCE_DURATION);
              }
            }
          }
        };

        source.connect(processor);
        processor.connect(audioContextRef.current.destination);
      };

      ws.onmessage = async (event) => {
        try {
          // Handle both text and Blob data
          let data = event.data;
          
          // If data is a Blob, convert to text first
          if (data instanceof Blob) {
            data = await data.text();
          }
          
          const response = JSON.parse(data);
          console.log('Received response:', response);
          
          // Handle setup confirmation
          if (response.setupComplete) {
            console.log('Setup complete');
            return;
          }

          // Handle audio response
          if (response.serverContent?.modelTurn?.parts) {
            const parts = response.serverContent.modelTurn.parts;
            console.log('📦 Parts received:', JSON.stringify(parts, null, 2));
            
            for (const part of parts) {
              // Check for ANY inline data (audio in any format)
              if (part.inlineData?.data) {
                const mimeType = part.inlineData.mimeType || 'unknown';
                console.log('🔊 Received audio data!');
                console.log('   - Mime type:', mimeType);
                console.log('   - Data length:', part.inlineData.data.length);
                
                try {
                  // Decode base64 to binary
                  const audioData = base64ToArrayBuffer(part.inlineData.data);
                  console.log('   - Decoded buffer size:', audioData.byteLength, 'bytes');
                  
                  // Play the audio
                  const { source: audioSource, duration, playTime } = await playAudioData(
                    audioContextRef.current, 
                    audioData, 
                    nextStartTimeRef.current
                  );
                  
                  nextStartTimeRef.current = playTime + duration;
                  
                  setStatus('🔊 Speaking...');
                  console.log('✅ Audio playback scheduled!');
                  
                  // Don't stop recording here, as it closes the WebSocket
                  // and we might receive multiple chunks or want to continue the conversation
                  /*
                  audioSource.onended = () => {
                    console.log('✅ Audio playback finished - stopping recording');
                    stopRecording();
                  };
                  */
                } catch (audioErr) {
                  console.error('❌ Error playing audio:', audioErr);
                  setError('Failed to play audio response');
                }
              }
              
              // Log text responses (shouldn't happen if audio is configured)
              if (part.text) {
                console.log('⚠️ Received TEXT instead of audio:', part.text);
              }
            }
          }

          // Handle turn complete
          if (response.serverContent?.turnComplete) {
            setStatus('Response complete. Speak again...');
          }

        } catch (err) {
          console.error('Error processing message:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        setError('Connection error occurred');
        stopRecording();
      };

      ws.onclose = () => {
        console.log('WebSocket closed');
        if (isRecording) {
          setStatus('Disconnected');
        }
      };

    } catch (err) {
      console.error('Error starting recording:', err);
      setError(err.message || 'Failed to start recording');
      setStatus('Error occurred');
      stopRecording();
    }
  };

  const stopRecording = () => {
    setIsRecording(false);
    setStatus('Stopped');

    // Clear voice activity detection timers
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    audioBufferRef.current = [];
    isSpeakingRef.current = false;

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Stop audio processing
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }

    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  };

  return (
    <div className="app">
      <div className="container">
        <div className="header">
          <h1>🎤 Voice Assistant</h1>
          <p className="subtitle">Powered by Gemini AI</p>
        </div>

        <div className={`microphone-visual ${isRecording ? 'active' : ''}`}>
          <div className="mic-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="23"></line>
              <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
          </div>
          {isRecording && <div className="pulse-ring"></div>}
        </div>

        <div className="status-section">
          <p className={`status-text ${error ? 'error' : ''}`}>
            {error || status}
          </p>
        </div>

        <div className="controls">
          <button 
            className={`btn ${isRecording ? 'btn-stop' : 'btn-start'}`}
            onClick={isRecording ? stopRecording : startRecording}
          >
            {isRecording ? (
              <>
                <span className="btn-icon">⏹</span>
                Stop
              </>
            ) : (
              <>
                <span className="btn-icon">🎙️</span>
                Start Talking
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
