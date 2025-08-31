/**
 * STT Routes
 * Speech-to-Text testing routes with file upload support
 */
import express from 'express';
import multer from 'multer';
import { testSTT, transcribeStreamChunk } from '../controllers/sttTestController';
import logger from '../utils/logger';

const router = express.Router();

// Configure multer for memory storage (no disk writes)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
    files: 1 // Only allow 1 file at a time
  },
  fileFilter: (req, file, cb) => {
    // Accept common audio formats
    const allowedMimeTypes = [
      'audio/wav',
      'audio/wave',
      'audio/x-wav',
      'audio/mpeg',
      'audio/mp3',
      'audio/mp4',
      'audio/m4a',
      'audio/aac',
      'audio/ogg',
      'audio/oga',
      'audio/webm',
      'audio/flac',
      'application/octet-stream' // For some browsers that don't set proper MIME type
    ];

    if (allowedMimeTypes.includes(file.mimetype) || 
        file.originalname?.match(/\.(wav|mp3|m4a|aac|ogg|webm|flac)$/i)) {
      cb(null, true);
    } else {
      logger.warn('Rejected file upload due to unsupported format', {
        mimetype: file.mimetype,
        filename: file.originalname
      });
      cb(new Error('Unsupported audio format. Please use WAV, MP3, M4A, AAC, OGG, WebM, or FLAC.'));
    }
  }
});

// Log middleware for STT routes
router.use((req, res, next) => {
  logger.info(`STT route: ${req.method} ${req.originalUrl}`);
  next();
});

/**
 * POST /api/stt/test
 * Single-shot STT test endpoint
 * Accepts either multipart/form-data with field "audio" or JSON with { audioBase64, language?, model? }
 */
router.post('/test', upload.single('audio'), testSTT);

/**
 * POST /api/stt/stream-chunk
 * Chunked near real-time STT endpoint
 * Accepts multipart/form-data with field "audio" (short chunks from MediaRecorder)
 */
router.post('/stream-chunk', upload.single('audio'), transcribeStreamChunk);

/**
 * GET /stt/live-test
 * Live microphone test page
 * Serves a self-contained HTML page for real-time speech testing
 */
router.get('/live-test', (req, res) => {
  logger.info('Serving STT live test page');
  
  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Speech-to-Text Live Test</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background: white;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            text-align: center;
            margin-bottom: 30px;
        }
        .controls {
            display: flex;
            gap: 15px;
            align-items: center;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }
        .control-group {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }
        label {
            font-weight: 500;
            color: #555;
            font-size: 14px;
        }
        select, button {
            padding: 8px 12px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
        }
        button {
            background: #007bff;
            color: white;
            border: none;
            cursor: pointer;
            font-weight: 500;
            transition: background-color 0.2s;
        }
        button:hover:not(:disabled) {
            background: #0056b3;
        }
        button:disabled {
            background: #6c757d;
            cursor: not-allowed;
        }
        .status {
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 20px;
            font-weight: 500;
        }
        .status.info {
            background: #d1ecf1;
            color: #0c5460;
            border: 1px solid #bee5eb;
        }
        .status.success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        .status.error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        .status.recording {
            background: #fff3cd;
            color: #856404;
            border: 1px solid #ffeaa7;
        }
        .transcripts {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 4px;
            padding: 15px;
            min-height: 200px;
            max-height: 400px;
            overflow-y: auto;
        }
        .transcript-entry {
            margin-bottom: 10px;
            padding: 8px;
            background: white;
            border-radius: 4px;
            border-left: 3px solid #007bff;
        }
        .transcript-meta {
            font-size: 12px;
            color: #6c757d;
            margin-bottom: 4px;
        }
        .transcript-text {
            color: #333;
            line-height: 1.4;
        }
        .empty-state {
            text-align: center;
            color: #6c757d;
            font-style: italic;
            padding: 40px 20px;
        }
        .recording-indicator {
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }
        .recording-dot {
            width: 8px;
            height: 8px;
            background: #dc3545;
            border-radius: 50%;
            animation: pulse 1s infinite;
        }
        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }
        .stats {
            display: flex;
            gap: 20px;
            margin-top: 15px;
            font-size: 14px;
            color: #6c757d;
        }
        .stats span {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .stats .value {
            font-weight: 600;
            color: #333;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎙️ Speech-to-Text Live Test</h1>
        
        <div class="controls">
            <div class="control-group">
                <label for="language">Language:</label>
                <select id="language">
                    <option value="en-US">English (US)</option>
                    <option value="en-GB">English (UK)</option>
                    <option value="es-ES">Spanish</option>
                    <option value="fr-FR">French</option>
                    <option value="de-DE">German</option>
                    <option value="it-IT">Italian</option>
                    <option value="pt-BR">Portuguese (Brazil)</option>
                </select>
            </div>
            
            <div class="control-group">
                <label for="model">Model:</label>
                <select id="model">
                    <option value="nova-2">Nova 2 (Latest)</option>
                    <option value="nova">Nova</option>
                    <option value="enhanced">Enhanced</option>
                    <option value="base">Base</option>
                </select>
            </div>
            
            <button id="startBtn">Start Recording</button>
            <button id="stopBtn" disabled>Stop Recording</button>
            <button id="clearBtn">Clear Transcripts</button>
        </div>
        
        <div id="status" class="status info">
            Click "Start Recording" to begin speech recognition. Make sure to allow microphone access when prompted.
        </div>
        
        <div class="transcripts" id="transcripts">
            <div class="empty-state">
                No transcripts yet. Start recording to see speech recognition results appear here in real-time.
            </div>
        </div>
        
        <div class="stats">
            <span>
                <div class="value" id="chunkCount">0</div>
                <div>Chunks Processed</div>
            </span>
            <span>
                <div class="value" id="avgLatency">0ms</div>
                <div>Avg Latency</div>
            </span>
            <span>
                <div class="value" id="totalWords">0</div>
                <div>Words Recognized</div>
            </span>
        </div>
    </div>

    <script>
        let mediaRecorder;
        let audioChunks = [];
        let isRecording = false;
        let chunkCount = 0;
        let totalLatency = 0;
        let totalWords = 0;
        
        const startBtn = document.getElementById('startBtn');
        const stopBtn = document.getElementById('stopBtn');
        const clearBtn = document.getElementById('clearBtn');
        const status = document.getElementById('status');
        const transcripts = document.getElementById('transcripts');
        const languageSelect = document.getElementById('language');
        const modelSelect = document.getElementById('model');
        
        // Statistics elements
        const chunkCountEl = document.getElementById('chunkCount');
        const avgLatencyEl = document.getElementById('avgLatency');
        const totalWordsEl = document.getElementById('totalWords');
        
        function updateStatus(message, type = 'info') {
            status.className = \`status \${type}\`;
            status.innerHTML = message;
        }
        
        function addTranscript(text, metadata) {
            // Remove empty state if present
            if (transcripts.querySelector('.empty-state')) {
                transcripts.innerHTML = '';
            }
            
            const entry = document.createElement('div');
            entry.className = 'transcript-entry';
            
            const meta = document.createElement('div');
            meta.className = 'transcript-meta';
            meta.textContent = \`\${new Date().toLocaleTimeString()} • \${metadata.model} • \${metadata.latency}ms • Confidence: \${(metadata.confidence * 100).toFixed(1)}%\`;
            
            const textDiv = document.createElement('div');
            textDiv.className = 'transcript-text';
            textDiv.textContent = text || '[No speech detected]';
            
            entry.appendChild(meta);
            entry.appendChild(textDiv);
            transcripts.appendChild(entry);
            
            // Auto-scroll to bottom
            transcripts.scrollTop = transcripts.scrollHeight;
            
            // Update statistics
            chunkCount++;
            totalLatency += metadata.latency;
            const words = (text || '').split(/\\s+/).filter(w => w.length > 0).length;
            totalWords += words;
            
            chunkCountEl.textContent = chunkCount;
            avgLatencyEl.textContent = chunkCount > 0 ? Math.round(totalLatency / chunkCount) + 'ms' : '0ms';
            totalWordsEl.textContent = totalWords;
        }
        
        async function sendAudioChunk(audioBlob) {
            const formData = new FormData();
            formData.append('audio', audioBlob, 'chunk.webm');
            formData.append('language', languageSelect.value);
            formData.append('model', modelSelect.value);
            
            try {
                const response = await fetch('/api/stt/stream-chunk', {
                    method: 'POST',
                    body: formData
                });
                
                const result = await response.json();
                
                if (result.success) {
                    addTranscript(result.transcript, {
                        model: result.model,
                        latency: result.latencyMs,
                        confidence: result.confidence
                    });
                } else {
                    console.error('Transcription failed:', result.message);
                    updateStatus(\`Error: \${result.message}\`, 'error');
                }
            } catch (error) {
                console.error('Network error:', error);
                updateStatus('Network error: Unable to connect to STT service', 'error');
            }
        }
        
        async function startRecording() {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ 
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    } 
                });
                
                mediaRecorder = new MediaRecorder(stream, {
                    mimeType: 'audio/webm;codecs=opus'
                });
                
                mediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                        sendAudioChunk(event.data);
                    }
                };
                
                mediaRecorder.onstart = () => {
                    isRecording = true;
                    startBtn.disabled = true;
                    stopBtn.disabled = false;
                    languageSelect.disabled = true;
                    modelSelect.disabled = true;
                    updateStatus('<div class="recording-indicator"><span class="recording-dot"></span>Recording... Speak into your microphone</div>', 'recording');
                };
                
                mediaRecorder.onstop = () => {
                    isRecording = false;
                    startBtn.disabled = false;
                    stopBtn.disabled = true;
                    languageSelect.disabled = false;
                    modelSelect.disabled = false;
                    updateStatus('Recording stopped. Click "Start Recording" to record again.', 'success');
                    
                    // Stop all tracks to release microphone
                    stream.getTracks().forEach(track => track.stop());
                };
                
                // Start recording and send chunks every 1 second
                mediaRecorder.start(1000);
                
            } catch (error) {
                console.error('Error accessing microphone:', error);
                updateStatus('Error: Unable to access microphone. Please ensure you have granted microphone permissions.', 'error');
            }
        }
        
        function stopRecording() {
            if (mediaRecorder && isRecording) {
                mediaRecorder.stop();
            }
        }
        
        function clearTranscripts() {
            transcripts.innerHTML = '<div class="empty-state">No transcripts yet. Start recording to see speech recognition results appear here in real-time.</div>';
            chunkCount = 0;
            totalLatency = 0;
            totalWords = 0;
            chunkCountEl.textContent = '0';
            avgLatencyEl.textContent = '0ms';
            totalWordsEl.textContent = '0';
        }
        
        // Event listeners
        startBtn.addEventListener('click', startRecording);
        stopBtn.addEventListener('click', stopRecording);
        clearBtn.addEventListener('click', clearTranscripts);
        
        // Check for microphone permission on page load
        navigator.permissions.query({ name: 'microphone' }).then((result) => {
            if (result.state === 'denied') {
                updateStatus('Microphone access denied. Please enable microphone permissions in your browser settings.', 'error');
            }
        }).catch(() => {
            // Permissions API not supported, continue normally
        });
    </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(htmlContent);
});

export default router;