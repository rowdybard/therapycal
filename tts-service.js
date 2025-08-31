// Text-to-Speech Service using ElevenLabs API
// Provides natural voice responses for the therapy calendar assistant

class TTSService {
    constructor() {
        this.apiKey = null;
        this.baseUrl = 'https://api.elevenlabs.io/v1';
        this.voiceId = 'EXAVITQu4vr4xnSDxMaL'; // Default voice (Sarah)
        this.isEnabled = false;
        this.isPlaying = false;
        this.currentAudio = null;
        
        this.initializeService();
    }

    initializeService() {
        // Check for ElevenLabs API key
        if (window.ELEVENLABS_API_KEY) {
            this.apiKey = window.ELEVENLABS_API_KEY;
            this.isEnabled = true;
            console.log('ElevenLabs TTS service initialized');
        } else {
            console.log('ElevenLabs API key not found - TTS disabled');
        }
    }

    // Available voices for different personalities
    getVoices() {
        return {
            sarah: 'EXAVITQu4vr4xnSDxMaL', // Professional female voice
            rachel: '21m00Tcm4TlvDq8ikWAM', // Warm female voice  
            adam: 'pNInz6obpgDQGcFmaJgB', // Professional male voice
            antoni: 'ErXwobaYiN019PkySvjV', // Calm male voice
            domi: 'AZnzlk1XvdvUeBnXmlld', // Energetic female voice
            elli: 'MF3mGyEYCl7XYWbV9V6O', // Young female voice
        };
    }

    // Set voice personality
    setVoice(voiceName = 'sarah') {
        const voices = this.getVoices();
        if (voices[voiceName]) {
            this.voiceId = voices[voiceName];
            console.log(`Voice set to: ${voiceName}`);
        }
    }

    // Check if TTS is available and enabled
    isAvailable() {
        return this.isEnabled && this.apiKey;
    }

    // Stop current audio playback
    stop() {
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
            this.isPlaying = false;
        }
    }

    // Generate speech from text
    async speak(text, options = {}) {
        // Stop any current playback
        this.stop();

        try {
            console.log('Generating speech for:', text.substring(0, 100) + '...');

            let audioBlob;
            if (typeof window !== 'undefined' && window.API_BASE_URL) {
                // Use server proxy (preferred)
                const resp = await fetch(`${window.API_BASE_URL}/api/tts`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        text: text,
                        voiceId: this.voiceId,
                        settings: {
                            stability: options.stability || 0.5,
                            similarity_boost: options.similarity_boost || 0.8,
                            style: options.style || 0.0,
                            use_speaker_boost: options.use_speaker_boost || true
                        }
                    })
                });
                if (!resp.ok) {
                    throw new Error(`TTS proxy error: ${resp.status} ${resp.statusText}`);
                }
                audioBlob = await resp.blob();
            } else {
                // Direct browser call (requires window.ELEVENLABS_API_KEY)
                if (!this.isAvailable()) {
                    console.log('TTS not available - text:', text);
                    return false;
                }
                const response = await fetch(`${this.baseUrl}/text-to-speech/${this.voiceId}`, {
                    method: 'POST',
                    headers: {
                        'Accept': 'audio/mpeg',
                        'Content-Type': 'application/json',
                        'xi-api-key': this.apiKey
                    },
                    body: JSON.stringify({
                        text: text,
                        model_id: 'eleven_monolingual_v1',
                        voice_settings: {
                            stability: options.stability || 0.5,
                            similarity_boost: options.similarity_boost || 0.8,
                            style: options.style || 0.0,
                            use_speaker_boost: options.use_speaker_boost || true
                        }
                    })
                });
                if (!response.ok) {
                    throw new Error(`ElevenLabs API error: ${response.status} ${response.statusText}`);
                }
                audioBlob = await response.blob();
            }

            const audioUrl = URL.createObjectURL(audioBlob);
            
            // Create and play audio
            this.currentAudio = new Audio(audioUrl);
            this.isPlaying = true;
            
            // Add event listeners
            this.currentAudio.addEventListener('ended', () => {
                this.isPlaying = false;
                URL.revokeObjectURL(audioUrl);
                console.log('Speech playback completed');
            });
            
            this.currentAudio.addEventListener('error', (e) => {
                console.error('Audio playback error:', e);
                this.isPlaying = false;
                URL.revokeObjectURL(audioUrl);
            });
            
            // Play the audio
            await this.currentAudio.play();
            console.log('Speech playback started');
            return true;
            
        } catch (error) {
            console.error('TTS Error:', error);
            this.isPlaying = false;
            return false;
        }
    }

    // Speak AI response with appropriate formatting
    async speakAIResponse(response, type = 'general') {
        if (!response) return false;
        
        // Clean up response text for better speech
        let cleanText = response
            .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold markdown
            .replace(/\*(.*?)\*/g, '$1') // Remove italic markdown
            .replace(/\n+/g, '. ') // Replace line breaks with pauses
            .replace(/([.!?])\s*([A-Z])/g, '$1 $2') // Add pauses between sentences
            .trim();
        
        // Different voice settings for different types of responses
        const voiceSettings = {
            general: { stability: 0.5, similarity_boost: 0.8 },
            appointment: { stability: 0.6, similarity_boost: 0.9 },
            confirmation: { stability: 0.7, similarity_boost: 0.8 },
            error: { stability: 0.4, similarity_boost: 0.7 }
        };
        
        return await this.speak(cleanText, voiceSettings[type] || voiceSettings.general);
    }

    // Quick status check
    getStatus() {
        return {
            enabled: this.isEnabled,
            available: this.isAvailable(),
            playing: this.isPlaying,
            voice: this.voiceId
        };
    }

    // Toggle TTS on/off
    toggle() {
        if (this.isPlaying) {
            this.stop();
        }
        this.isEnabled = !this.isEnabled;
        console.log(`TTS ${this.isEnabled ? 'enabled' : 'disabled'}`);
        return this.isEnabled;
    }
}

// Create global TTS service instance
window.ttsService = new TTSService();

// Add TTS controls to the voice assistant interface
function addTTSControls() {
    // Add TTS toggle button to voice modal
    const voiceModal = document.getElementById('voice-modal');
    if (voiceModal && window.ttsService.isAvailable()) {
        const ttsControls = document.createElement('div');
        ttsControls.className = 'flex items-center justify-between mt-4 pt-4 border-t border-gray-200';
        ttsControls.innerHTML = `
            <div class="flex items-center space-x-2">
                <span class="material-icons text-blue-600">volume_up</span>
                <span class="text-sm text-gray-700">Voice Responses</span>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" id="tts-toggle" class="sr-only peer" ${window.ttsService.isEnabled ? 'checked' : ''}>
                <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
        `;
        
        // Find the voice modal content area to add controls
        const modalContent = voiceModal.querySelector('.bg-white');
        if (modalContent) {
            modalContent.appendChild(ttsControls);
            
            // Add toggle functionality
            const ttsToggle = document.getElementById('tts-toggle');
            if (ttsToggle) {
                ttsToggle.addEventListener('change', (e) => {
                    window.ttsService.toggle();
                });
            }
        }
    }
}

// Initialize TTS controls when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addTTSControls);
} else {
    addTTSControls();
}