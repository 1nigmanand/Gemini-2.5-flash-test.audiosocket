# Gemini Live Audio Demo

A simple React.js application that demonstrates **real-time voice interaction** with Google's Gemini AI using native audio streaming via the Gemini Live API.

## 🎯 Features

- **Live microphone capture** using Web Audio API
- **Real-time audio streaming** to Gemini AI
- **Bidirectional audio** communication via WebSocket
- **Voice responses** played back directly
- Simple, clean UI with start/stop controls

## 🏗️ Architecture

```
User speaks → Microphone → Web Audio API → PCM16 conversion →
WebSocket → Gemini Live API → Audio response →
Base64 decode → Audio playback
```

**Key Technologies:**
- React.js (via Vite)
- Web Audio API for capture and playback
- WebSocket for real-time communication
- PCM 16-bit audio at 16kHz sample rate

## 📁 Project Structure

```
test_audio/
├── src/
│   ├── App.jsx           # Main React component
│   ├── App.css           # Component styles
│   ├── audioUtils.js     # Audio conversion utilities
│   ├── main.jsx          # React entry point
│   └── index.css         # Global styles
├── index.html            # HTML template
├── vite.config.js        # Vite configuration
├── package.json          # Dependencies
├── .env.example          # Environment template
└── README.md             # This file
```

## 🚀 Getting Started

### Prerequisites

- Node.js 16+ and npm installed
- A **Gemini API key** (get one at [Google AI Studio](https://makersuite.google.com/app/apikey))
- Modern browser with microphone support (Chrome, Edge, Safari recommended)

### Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   ```

3. **Add your Gemini API key to `.env`:**
   ```
   VITE_GEMINI_API_KEY=YOUR_ACTUAL_API_KEY_HERE
   ```
   ⚠️ **IMPORTANT:** Never commit the `.env` file to version control!

### Running the App

```bash
npm run dev
```

The app will start at `http://localhost:3000`

## 🎙️ How to Use

1. Click **"Start Talking"** button
2. Allow microphone access when prompted
3. Wait for "Connected! Start speaking..." status
4. **Speak your question** clearly
5. Listen to Gemini's audio response
6. Click **"Stop"** when finished

**Example questions to try:**
- "What's the weather like today?"
- "Tell me a fun fact about space"
- "Explain quantum computing in simple terms"

## 🔧 Technical Details

### Audio Processing Flow

1. **Capture:** Browser captures audio at 16kHz mono
2. **Convert:** Float32 audio → PCM16 format
3. **Encode:** PCM16 → Base64 for JSON transmission
4. **Send:** WebSocket sends audio chunks to Gemini
5. **Receive:** Gemini streams back PCM16 audio
6. **Decode:** Base64 → ArrayBuffer
7. **Play:** Web Audio API plays the response

### API Configuration

- **Model:** `gemini-2.5-flash-native-audio-preview-12-2025`
- **Audio Format:** PCM 16-bit, mono, 16kHz
- **Protocol:** WebSocket (bidirectional streaming)
- **Endpoint:** `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent`

### Browser Compatibility

| Browser | Support |
|---------|---------|
| Chrome  | ✅ Full |
| Edge    | ✅ Full |
| Safari  | ✅ Full |
| Firefox | ⚠️ Limited (WebKit audio issues) |

## ❗ Common Issues & Solutions

### Issue: "VITE_GEMINI_API_KEY not found"
**Solution:** Make sure you created a `.env` file (not `.env.example`) with your actual API key.

### Issue: "Connection error occurred"
**Solutions:**
- Verify your API key is correct and active
- Check if the Gemini Live API is available in your region
- Ensure you have an active internet connection
- Try refreshing the page

### Issue: Microphone not working
**Solutions:**
- Grant microphone permissions in browser settings
- Check if another app is using the microphone
- Try using HTTPS (some browsers require it)
- Test microphone in browser settings first

### Issue: No audio response
**Solutions:**
- Check browser console for errors
- Ensure speakers/headphones are working
- Verify audio output device in system settings
- Try speaking more clearly and waiting longer

### Issue: WebSocket closes immediately
**Solutions:**
- Verify API key has correct permissions
- Check if model name is spelled correctly
- Ensure you're not hitting rate limits
- Check Google AI Studio for service status

### Issue: Audio quality is poor
**Solutions:**
- Use a better microphone
- Reduce background noise
- Speak closer to the microphone
- Check browser audio input settings

## 🛠️ Development

### Build for Production

```bash
npm run build
```

Output will be in the `dist/` directory.

### Preview Production Build

```bash
npm run preview
```

## 📚 Code Explanation

### Key Files

**App.jsx:**
- Main React component
- Manages WebSocket connection
- Handles audio recording state
- Processes incoming/outgoing audio

**audioUtils.js:**
- `floatTo16BitPCM()` - Converts browser audio to PCM16
- `arrayBufferToBase64()` - Encodes audio for transmission
- `base64ToArrayBuffer()` - Decodes received audio
- `playAudioData()` - Plays audio through speakers

### WebSocket Message Flow

**Client → Gemini (Setup):**
```json
{
  "setup": {
    "model": "models/gemini-2.5-flash-native-audio-preview-12-2025",
    "generationConfig": {
      "responseModalities": ["AUDIO"]
    }
  }
}
```

**Client → Gemini (Audio chunk):**
```json
{
  "realtimeInput": {
    "mediaChunks": [{
      "mimeType": "audio/pcm",
      "data": "<base64_audio_data>"
    }]
  }
}
```

**Gemini → Client (Response):**
```json
{
  "serverContent": {
    "modelTurn": {
      "parts": [{
        "inlineData": {
          "mimeType": "audio/pcm",
          "data": "<base64_audio_response>"
        }
      }]
    },
    "turnComplete": true
  }
}
```

## 🔐 Security Notes

- **Never commit your API key** - it's in `.gitignore` for a reason
- API key is exposed in client-side code (frontend-only demo)
- For production, use a backend server to protect your API key
- Consider implementing rate limiting and authentication

## 📖 Resources

- [Gemini API Documentation](https://ai.google.dev/docs)
- [Gemini Live API Guide](https://ai.google.dev/api/multimodal-live)
- [Web Audio API MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Get Gemini API Key](https://makersuite.google.com/app/apikey)

## 📝 Notes

- This is a **demo/learning project**, not production-ready
- Audio quality depends on microphone and browser
- WebSocket connections may timeout after inactivity
- Requires modern browser with Web Audio API support
- Some browsers require HTTPS for microphone access

## 🎓 Learning Points

This project demonstrates:
1. Real-time audio capture with Web Audio API
2. Audio format conversion (Float32 ↔ PCM16)
3. WebSocket bidirectional streaming
4. React state management for async operations
5. Environment variable handling in Vite
6. Base64 encoding/decoding for binary data

## 🤝 Contributing

This is a simple demo project. Feel free to fork and experiment!

## 📄 License

MIT License - feel free to use this for learning and experimentation.

---

**Built with ❤️ using React, Vite, and Google Gemini AI**
