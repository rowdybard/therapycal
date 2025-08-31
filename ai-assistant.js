// AI Assistant for Therapy Calendar
// Handles OpenAI integration for intelligent features

// Import Firebase auth
import { auth } from './firebase-config.js';

// Note: OpenAI is loaded via CDN in browser environment

// Initialize OpenAI client
let openai = null;

// Initialize OpenAI using backend API
function initializeOpenAI() {
    if (!openai && window.API_BASE_URL) {
        // Use backend API proxy
        openai = {
            chat: {
                completions: {
                    create: async (params) => {
                        // Get Firebase auth token
                        const user = auth?.currentUser;
                        if (!user) throw new Error('Authentication required');
                        const token = await user.getIdToken();
                        
                        const response = await fetch(`${window.API_BASE_URL}/api/chat`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${token}`
                            },
                            body: JSON.stringify(params)
                        });
                        
                        if (!response.ok) {
                            throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
                        }
                        
                        return await response.json();
                    }
                }
            },
            audio: {
                transcriptions: {
                    create: async (params) => {
                        // Get Firebase auth token
                        const user = auth?.currentUser;
                        if (!user) throw new Error('Authentication required');
                        const token = await user.getIdToken();
                        
                        const formData = new FormData();
                        formData.append('file', params.file);
                        formData.append('model', params.model);
                        if (params.response_format) {
                            formData.append('response_format', params.response_format);
                        }
                        
                        const response = await fetch(`${window.API_BASE_URL}/api/transcriptions`, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${token}`
                            },
                            body: formData
                        });
                        
                        if (!response.ok) {
                            throw new Error(`OpenAI Audio API error: ${response.status} ${response.statusText}`);
                        }
                        
                        return await response.json();
                    }
                }
            }
        };
    }
    return openai;
}

// AI Assistant class
class TherapyAIAssistant {
    constructor() {
        this.model = "gpt-4o"; // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
    }

    // Generate appointment summary and insights
    async generateAppointmentSummary(appointments, clients, providers, timeframe = 'week') {
        const client = initializeOpenAI();
        if (!client) {
            throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY in your environment.');
        }
        
        try {
            const appointmentData = appointments.map(apt => {
                const client = clients.find(c => c.id === apt.clientId);
                const provider = providers.find(p => p.id === apt.providerId);
                return {
                    client: client ? client.name : 'Unknown',
                    provider: provider ? provider.name : 'Unassigned',
                    date: apt.start.toLocaleDateString(),
                    time: apt.start.toLocaleTimeString(),
                    duration: apt.duration,
                    status: apt.status || 'scheduled',
                    notes: apt.notes || ''
                };
            });

            const prompt = `As a therapy practice assistant, analyze the following ${timeframe} appointment data and provide insights:

${JSON.stringify(appointmentData, null, 2)}

Please provide a professional summary including:
1. Key statistics and patterns
2. Scheduling efficiency observations
3. Client engagement insights
4. Recommendations for practice improvement

Format as JSON with sections: summary, insights, recommendations`;

            const response = await client.chat.completions.create({
                model: this.model,
                messages: [
                    {
                        role: "system",
                        content: "You are an expert therapy practice management assistant. Provide professional, actionable insights while maintaining client confidentiality."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                response_format: { type: "json_object" },
                max_tokens: 1000
            });

            return JSON.parse(response.choices[0].message.content);
        } catch (error) {
            console.error('Error generating appointment summary:', error);
            throw new Error('Failed to generate appointment summary');
        }
    }

    // Suggest optimal scheduling times
    async suggestOptimalScheduling(appointments, clients, workingHours) {
        const client = initializeOpenAI();
        if (!client) {
            throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY in your environment.');
        }
        
        try {
            const busyTimes = appointments.map(apt => ({
                day: apt.start.toLocaleDateString(),
                time: apt.start.toLocaleTimeString(),
                duration: apt.duration
            }));

            const prompt = `Analyze the current appointment schedule and suggest optimal scheduling patterns:

Current appointments: ${JSON.stringify(busyTimes, null, 2)}
Working hours: ${workingHours.start} - ${workingHours.end}

Provide scheduling optimization suggestions including:
1. Peak busy times to avoid overbooking
2. Optimal time slots for new appointments  
3. Buffer time recommendations
4. Weekly scheduling patterns

Respond in JSON format with sections: peakTimes, optimalSlots, recommendations`;

            const response = await client.chat.completions.create({
                model: this.model,
                messages: [
                    {
                        role: "system", 
                        content: "You are a scheduling optimization expert for therapy practices. Provide practical scheduling advice."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                response_format: { type: "json_object" },
                max_tokens: 800
            });

            return JSON.parse(response.choices[0].message.content);
        } catch (error) {
            console.error('Error generating scheduling suggestions:', error);
            throw new Error('Failed to generate scheduling suggestions');
        }
    }

    // Generate client communication suggestions
    async generateClientCommunication(clientData, appointmentHistory, purpose = 'reminder') {
        const client = initializeOpenAI();
        if (!client) {
            throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY in your environment.');
        }
        
        try {
            const prompt = `Generate a professional ${purpose} message for a therapy client:

Client: ${clientData.name}
Recent appointments: ${appointmentHistory.length}
Last session: ${appointmentHistory[0]?.date || 'N/A'}

Create a warm, professional message for: ${purpose}
Keep it concise, empathetic, and appropriate for a therapy practice.

Respond in JSON format with: subject, message, tone`;

            const response = await client.chat.completions.create({
                model: this.model,
                messages: [
                    {
                        role: "system",
                        content: "You are a professional therapy practice communication specialist. Create empathetic, appropriate client communications."
                    },
                    {
                        role: "user", 
                        content: prompt
                    }
                ],
                response_format: { type: "json_object" },
                max_tokens: 400
            });

            return JSON.parse(response.choices[0].message.content);
        } catch (error) {
            console.error('Error generating client communication:', error);
            throw new Error('Failed to generate client communication');
        }
    }

    // Analyze session notes and provide insights
    async analyzeSessionNotes(notes, clientHistory) {
        const client = initializeOpenAI();
        if (!client) {
            throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY in your environment.');
        }
        
        try {
            const prompt = `Analyze these therapy session notes and provide professional insights:

Notes: "${notes}"
Client session history: ${clientHistory.length} previous sessions

Provide analysis including:
1. Key themes and patterns
2. Progress indicators
3. Areas for follow-up
4. Session effectiveness

Maintain strict confidentiality and therapeutic best practices.

Respond in JSON format with sections: themes, progress, followUp, recommendations`;

            const response = await client.chat.completions.create({
                model: this.model,
                messages: [
                    {
                        role: "system",
                        content: "You are a clinical therapy assistant providing session analysis. Maintain professional standards and client confidentiality."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                response_format: { type: "json_object" },
                max_tokens: 600
            });

            return JSON.parse(response.choices[0].message.content);
        } catch (error) {
            console.error('Error analyzing session notes:', error);
            throw new Error('Failed to analyze session notes');
        }
    }

    // Generate practice insights from analytics data
    async generatePracticeInsights(analyticsData) {
        const client = initializeOpenAI();
        if (!client) {
            throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY in your environment.');
        }
        
        try {
            const prompt = `Analyze this therapy practice data and provide business insights:

Analytics: ${JSON.stringify(analyticsData, null, 2)}

Provide professional analysis including:
1. Practice performance trends
2. Client retention insights  
3. Revenue optimization opportunities
4. Operational efficiency recommendations

Focus on actionable business insights for practice growth.

Respond in JSON format with sections: performance, retention, revenue, operations`;

            const response = await client.chat.completions.create({
                model: this.model,
                messages: [
                    {
                        role: "system",
                        content: "You are a healthcare practice management consultant providing data-driven insights for therapy practices."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                response_format: { type: "json_object" },
                max_tokens: 800
            });

            return JSON.parse(response.choices[0].message.content);
        } catch (error) {
            console.error('Error generating practice insights:', error);
            throw new Error('Failed to generate practice insights');
        }
    }

    // Smart appointment conflict resolution
    async suggestConflictResolution(conflictingAppointments, availableSlots) {
        const client = initializeOpenAI();
        if (!client) {
            throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY in your environment.');
        }
        
        try {
            const conflicts = conflictingAppointments.map(apt => ({
                client: apt.clientName,
                time: apt.start.toLocaleString(),
                duration: apt.duration,
                priority: apt.priority || 'normal'
            }));

            const slots = availableSlots.map(slot => ({
                time: slot.toLocaleString(),
                duration: 'flexible'
            }));

            const prompt = `Resolve scheduling conflicts for therapy appointments:

Conflicting appointments: ${JSON.stringify(conflicts, null, 2)}
Available time slots: ${JSON.stringify(slots, null, 2)}

Suggest optimal resolution considering:
1. Client priority and needs
2. Provider availability
3. Minimal disruption
4. Professional scheduling standards

Respond in JSON format with: resolution, alternativeSlots, reasoning`;

            const response = await client.chat.completions.create({
                model: this.model,
                messages: [
                    {
                        role: "system",
                        content: "You are a therapy practice scheduling coordinator expert at resolving appointment conflicts professionally."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                response_format: { type: "json_object" },
                max_tokens: 600
            });

            return JSON.parse(response.choices[0].message.content);
        } catch (error) {
            console.error('Error suggesting conflict resolution:', error);
            throw new Error('Failed to suggest conflict resolution');
        }
    }
}

// Voice Assistant for Calendar Commands
class VoiceCalendarAssistant {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.isProcessing = false;
        this.conversationHistory = [];
        this.continueMode = false;
    }

    async startRecording() {
        try {
            // Try to get available audio devices first
            let devices = [];
            try {
                devices = await navigator.mediaDevices.enumerateDevices();
                const audioInputs = devices.filter(device => device.kind === 'audioinput');
                console.log('Available audio devices:', audioInputs.map(d => ({ label: d.label, deviceId: d.deviceId })));
            } catch (e) {
                console.log('Could not enumerate devices, proceeding with default');
            }
            
            // Progressive fallback constraints - start with ideal, fallback to basic
            const constraintSets = [
                // First try: Optimal settings for external/dedicated microphones
                {
                    audio: {
                        echoCancellation: false, // External mics often don't need this
                        noiseSuppression: false, // Let external mic handle this
                        autoGainControl: true,
                        sampleRate: { ideal: 48000, min: 16000 },
                        channelCount: 1,
                        volume: { ideal: 1.0 },
                        latency: { ideal: 0.01 }
                    }
                },
                // Second try: Laptop microphone optimized settings
                {
                    audio: {
                        echoCancellation: true, // Laptop mics need this
                        noiseSuppression: true, // Laptop mics need this
                        autoGainControl: true,
                        sampleRate: { ideal: 44100, min: 16000 },
                        channelCount: 1,
                        volume: { ideal: 1.0 },
                        latency: { ideal: 0.01 }
                    }
                },
                // Third try: Basic compatibility mode
                {
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                        sampleRate: 16000,
                        channelCount: 1
                    }
                },
                // Last resort: Minimal constraints
                {
                    audio: true
                }
            ];
            
            let stream = null;
            let usedConstraints = null;
            
            // Try each constraint set until one works
            for (let i = 0; i < constraintSets.length; i++) {
                try {
                    console.log(`Trying constraint set ${i + 1}:`, constraintSets[i]);
                    stream = await navigator.mediaDevices.getUserMedia(constraintSets[i]);
                    usedConstraints = constraintSets[i];
                    console.log(`Success with constraint set ${i + 1}`);
                    break;
                } catch (error) {
                    console.log(`Constraint set ${i + 1} failed:`, error.message);
                    if (i === constraintSets.length - 1) {
                        throw error; // Re-throw the last error
                    }
                }
            }
            
            this.audioChunks = [];
            
            // Check for supported MIME types
            let mimeType;
            if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
                mimeType = 'audio/webm;codecs=opus';
            } else if (MediaRecorder.isTypeSupported('audio/webm')) {
                mimeType = 'audio/webm';
            } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
                mimeType = 'audio/mp4';
            } else {
                mimeType = ''; // Let browser decide
            }
            
            console.log('Using MIME type:', mimeType);
            
            this.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
            
            this.mediaRecorder.ondataavailable = (event) => {
                console.log('Audio data available:', event.data.size, 'bytes');
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };
            
            this.mediaRecorder.onstop = () => {
                console.log('Recording stopped, chunks:', this.audioChunks.length);
                // Don't auto-process here - let the UI handle it with proper timing
            };
            
            this.mediaRecorder.onerror = (event) => {
                console.error('MediaRecorder error:', event.error);
            };
            
            // Start recording with optimized time slices for laptop microphones
            this.mediaRecorder.start(250); // Larger chunks for better laptop compatibility
            this.isRecording = true;
            
            // Add comprehensive stream monitoring for debugging
            const audioTracks = stream.getAudioTracks();
            if (audioTracks.length > 0) {
                const track = audioTracks[0];
                const settings = track.getSettings();
                const capabilities = track.getCapabilities();
                
                console.log('Selected microphone details:');
                console.log('- Device ID:', settings.deviceId);
                console.log('- Label:', track.label);
                console.log('- Sample Rate:', settings.sampleRate, 'Hz');
                console.log('- Echo Cancellation:', settings.echoCancellation);
                console.log('- Noise Suppression:', settings.noiseSuppression);
                console.log('- Auto Gain Control:', settings.autoGainControl);
                console.log('- Channel Count:', settings.channelCount);
                console.log('- Used constraints:', usedConstraints);
                console.log('- Full settings:', settings);
                console.log('- Capabilities:', capabilities);
                
                // Check if this looks like a laptop internal mic vs external
                const isLikelyLaptopMic = track.label.toLowerCase().includes('internal') || 
                                        track.label.toLowerCase().includes('built-in') ||
                                        track.label.toLowerCase().includes('laptop') ||
                                        settings.echoCancellation === true;
                console.log('- Detected microphone type:', isLikelyLaptopMic ? 'Laptop/Built-in' : 'External/Dedicated');
            }
            
            console.log('Recording started successfully');
            return true;
        } catch (error) {
            console.error('Error starting recording:', error);
            if (error.name === 'NotAllowedError') {
                throw new Error('Microphone permission denied. Please allow microphone access.');
            } else if (error.name === 'NotFoundError') {
                throw new Error('No microphone found. Please check your microphone connection.');
            } else {
                throw new Error('Unable to access microphone: ' + error.message);
            }
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            // Set a flag to prevent processing until we have enough data
            this.isRecording = false;
            
            // Stop the recorder - this will trigger ondataavailable and onstop
            this.mediaRecorder.stop();
            
            // Stop all tracks to release microphone after a small delay
            setTimeout(() => {
                if (this.mediaRecorder && this.mediaRecorder.stream) {
                    this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
                }
            }, 100);
        }
    }

    async processRecording() {
        console.log('Processing recording, chunks available:', this.audioChunks.length);
        
        if (this.audioChunks.length === 0) {
            throw new Error('No audio data recorded. Please ensure your microphone is working and try speaking longer.');
        }
        
        this.isProcessing = true;
        
        try {
            // Create audio blob from chunks
            const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
            console.log('Audio blob size:', audioBlob.size, 'bytes');
            
            if (audioBlob.size === 0) {
                throw new Error('Recorded audio is empty. Please try recording again and speak clearly.');
            }
            
            // Create file for Whisper API with proper naming
            const timestamp = Date.now();
            const audioFile = new File([audioBlob], `recording_${timestamp}.webm`, { type: 'audio/webm' });
            
            // Check OpenAI client
            const client = initializeOpenAI();
            if (!client) {
                throw new Error('OpenAI API key not configured');
            }
            
            console.log('Sending audio to Whisper API...', {
                fileSize: audioFile.size,
                fileName: audioFile.name,
                audioType: audioFile.type,
                chunksCount: this.audioChunks.length
            });
            
            // Transcribe with OpenAI Whisper with enhanced settings
            const transcription = await client.audio.transcriptions.create({
                file: audioFile,
                model: 'whisper-1',
                response_format: 'verbose_json', // Get more detailed response
                language: 'en', // Specify English for better accuracy
                temperature: 0.0, // More deterministic output
                prompt: "This is a voice command for a therapy calendar application. The user might ask about scheduling appointments, general questions, or calendar management." // Context for better transcription
            });
            
            const transcript = transcription.text?.trim();
            console.log('Whisper full response:', transcription);
            console.log('Whisper transcript:', transcript);
            console.log('Whisper confidence/details:', {
                duration: transcription.duration,
                language: transcription.language,
                segments: transcription.segments
            });
            
            if (!transcript || transcript.length === 0) {
                throw new Error('No speech detected. Please speak clearly and try again.');
            }
            
            if (transcript.length < 3) {
                throw new Error(`Only captured "${transcript}". Please speak longer and more clearly.`);
            }
            
            // Process the voice command
            const response = await this.processVoiceCommand(transcript);
            
            return {
                transcript: transcript,
                response: response
            };
            
        } catch (error) {
            console.error('Error processing recording:', error);
            throw error;
        } finally {
            this.isProcessing = false;
        }
    }

    async processVoiceCommand(transcript) {
        const client = initializeOpenAI();
        if (!client) {
            throw new Error('OpenAI API key not configured');
        }

        try {
            // Check if we have conversation history for context
            const hasContext = this.conversationHistory && this.conversationHistory.length > 0;
            let requestType = "GENERAL";
            
            // Default to GENERAL unless explicit appointment/calendar triggers found
            const appointmentTriggers = [
                'make an appointment', 'schedule an appointment', 'book an appointment', 
                'cancel appointment', 'delete appointment', 'reschedule appointment',
                'schedule', 'book', 'cancel', 'delete', 'reschedule', 'client'
            ];
            
            // Time/date change triggers when there's a pending appointment
            const timeChangeTriggers = [
                'friday', 'monday', 'tuesday', 'wednesday', 'thursday', 'saturday', 'sunday',
                'tomorrow', 'today', 'next week', 'meant', 'change', 'instead'
            ];
            
            const hasAppointmentTrigger = appointmentTriggers.some(trigger => 
                transcript.toLowerCase().includes(trigger.toLowerCase())
            );
            
            // Check if there's a pending appointment and user is trying to modify it
            const hasPendingAppointment = window.pendingVoiceAppointment !== null;
            const hasTimeChangeTrigger = timeChangeTriggers.some(trigger => 
                transcript.toLowerCase().includes(trigger.toLowerCase())
            );
            
            if (hasAppointmentTrigger) {
                requestType = "CALENDAR";
                console.log('Detected appointment trigger word, classified as CALENDAR:', transcript);
            } else if (hasPendingAppointment && hasTimeChangeTrigger) {
                requestType = "CALENDAR";
                console.log('Pending appointment and time change detected, classified as CALENDAR:', transcript);
            } else {
                // Default to GENERAL for everything else
                requestType = "GENERAL";
                console.log('No appointment triggers found, defaulting to GENERAL:', transcript);
            }
            
            // Store request type for future reference
            this.lastRequestType = requestType;
            
            console.log('Final classification decision:', requestType, 'for transcript:', transcript);

            if (requestType === "CALENDAR") {
                console.log('Processing as CALENDAR command');
                const result = await this.processCalendarCommand(transcript, client);
                
                // Add to conversation history for calendar commands too
                this.conversationHistory.push({ role: 'user', content: transcript });
                this.conversationHistory.push({ role: 'assistant', content: result.response });
                
                // Keep only last 10 messages to manage context length
                if (this.conversationHistory.length > 10) {
                    this.conversationHistory = this.conversationHistory.slice(-10);
                }
                
                return result;
            } else {
                console.log('Processing as GENERAL command - full AI capabilities enabled');
                return await this.processGeneralCommandWithHistory(transcript, client);
            }
            
        } catch (error) {
            console.error('Error processing voice command:', error);
            return {
                action: 'error',
                response: 'Sorry, I had trouble understanding your request. Please try again.',
                needs_clarification: true
            };
        }
    }

    async processCalendarCommand(transcript, client) {
        // Include conversation history for context
        const conversationContext = this.conversationHistory.length > 0 
            ? `Previous conversation context:\n${this.conversationHistory.slice(-4).map(msg => `${msg.role}: ${msg.content}`).join('\n')}\n\n` 
            : '';

        // Check if there's a pending appointment that user might be modifying
        const pendingAppointment = window.pendingVoiceAppointment;
        const pendingContext = pendingAppointment ? 
            `\n\nIMPORTANT: There is currently a PENDING APPOINTMENT awaiting confirmation:
- Client: ${pendingAppointment.client_name || 'Unknown'}
- Date: ${pendingAppointment.date || 'Unknown'}
- Time: ${pendingAppointment.time || 'Unknown'}
- Provider: ${pendingAppointment.provider || 'Alex'}
- Duration: ${pendingAppointment.duration || 60} minutes

If the user is trying to change any of these details (like saying "I meant Friday" or "change to 3 PM"), treat it as a NEW SCHEDULE action with updated parameters, using the same "schedule" action type and maintaining the same parameter format (client_name, date, time, provider, duration).` : '';

        const prompt = `${conversationContext}You are a voice assistant for a therapy calendar application. The user said: "${transcript}"${pendingContext}

Available calendar actions you can perform:
1. Schedule appointments (provide date, time, client name, provider) - USE THIS FOR ALL APPOINTMENT CREATION AND MODIFICATIONS
2. Cancel appointments (set status to cancelled)
3. Delete appointments (permanently remove)
4. View calendar information
5. Add new clients
6. Update appointment details
7. Search for appointments
8. Provide calendar summaries

CRITICAL: Never use "reschedule" action. Always use "schedule" for both new appointments and modifications.

Context: This is a therapy practice management system with clients, providers, and appointments.

For scheduling appointments, extract these details:
- client_name: The name of the client
- date: Use "tomorrow", "next monday", "next tuesday", etc. for relative dates, or specific dates
- time: Convert to 24-hour format (e.g., "2 p.m." becomes "14:00")
- provider: Name of the provider if mentioned (default to "Alex" if not specified)
- duration: Session length in minutes (default 60)

If you have previous context about an appointment being scheduled, use that information and ask for missing details.

Examples:
"Make an appointment tomorrow at 2 p.m. for John with Alex" →
{
  "action": "schedule",
  "parameters": {
    "client_name": "John",
    "date": "tomorrow", 
    "time": "14:00",
    "provider": "Alex"
  }
}

"Move John's appointment to Friday at 3 PM" →
{
  "action": "schedule",
  "parameters": {
    "client_name": "John",
    "date": "Friday",
    "time": "15:00"
  }
}

IMPORTANT: For ANY appointment scheduling or modification, ALWAYS use action "schedule" (never "reschedule"). When modifying existing appointments, treat it as scheduling a new appointment with updated details.

Respond with a JSON object containing:
- action: The specific action to take (schedule, cancel, view, add_client, update, search, summary, or "clarify" if unclear)
- parameters: Object with relevant details needed for the action  
- response: A friendly message explaining what you understood and what action you'll take
- needs_clarification: boolean if you need more information

If the command is unclear or missing information, set action to "clarify" and ask for the missing details.`;

        const response = await client.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content: "You are a helpful voice assistant for a therapy calendar. Always respond in JSON format."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            response_format: { type: "json_object" },
            max_tokens: 500
        });

        const result = JSON.parse(response.choices[0].message.content);
        
        // For scheduling appointments, show confirmation instead of executing immediately
        if (result.action === 'schedule' && result.parameters) {
            result.needs_confirmation = true;
            result.response = `I'll help you schedule an appointment. Please confirm these details:\n\n${this.formatAppointmentDetails(result.parameters)}`;
            
            // Update the confirmation section if there are new parameters
            if (typeof window.updateAppointmentConfirmationDetails === 'function') {
                window.updateAppointmentConfirmationDetails(result.parameters);
                window.pendingVoiceAppointment = result.parameters; // Update pending data
            }
            // Don't execute yet - wait for confirmation
        } else if (result.action !== 'clarify') {
            await this.executeCalendarAction(result);
        }
        
        // Speak the calendar response
        if (window.ttsService && window.ttsService.isAvailable() && window.ttsService.isEnabled) {
            const responseType = result.action === 'schedule' ? 'appointment' : 
                               result.action === 'cancel' || result.action === 'delete' ? 'confirmation' :
                               result.needs_clarification ? 'error' : 'general';
            await window.ttsService.speakAIResponse(result.response, responseType);
        }
        
        return result;
    }

    async processGeneralCommandWithHistory(transcript, client) {
        console.log('Processing general command with enhanced functionality:', transcript);
        
        // Include conversation history for context
        const conversationContext = this.conversationHistory.length > 0 
            ? `Previous conversation context:\n${this.conversationHistory.slice(-3).map(msg => `${msg.role}: ${msg.content}`).join('\n')}\n\n` 
            : '';

        const prompt = `${conversationContext}User says: "${transcript}"

You are an advanced AI assistant with comprehensive capabilities. Handle ALL types of requests including:

**CALCULATIONS & MATH:**
- "What's 847 * 23?" → Calculate precisely
- "Convert 5 feet to meters" → Unit conversions
- "What percentage is 45 out of 200?" → Math problems

**GENERAL KNOWLEDGE:**
- "Who is LeBron James?" → Celebrity/sports information
- "Tell me about quantum physics" → Educational content
- "What's the capital of Slovenia?" → Geography facts

**PRACTICAL HELP:**
- "How do I cook pasta?" → Step-by-step instructions  
- "What's the weather like?" → Weather information
- "Define photosynthesis" → Scientific definitions
- "Translate 'hello' to Spanish" → Language translation

**TECHNOLOGY & TROUBLESHOOTING:**
- "How do I reset my router?" → Tech support
- "Explain machine learning" → Technology concepts

**ENTERTAINMENT & CULTURE:**
- "Tell me a joke" → Humor and entertainment
- "What's trending?" → Current events and pop culture

Provide thorough, accurate, and helpful responses. Be conversational and engaging.`;

        try {
            const response = await client.chat.completions.create({
                model: "gpt-4o", // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
                messages: [
                    {
                        role: "system",
                        content: "You are an advanced AI assistant with comprehensive knowledge and capabilities. Handle ALL types of user requests - from calculations to general knowledge and practical help. Be thorough, accurate, and conversational."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                max_tokens: 600,
                temperature: 0.7
            });

            const aiResponse = response.choices[0].message.content;
            console.log('General AI response generated:', aiResponse);

            // Add to conversation history
            this.conversationHistory.push({ role: 'user', content: transcript });
            this.conversationHistory.push({ role: 'assistant', content: aiResponse });

            // Keep only last 10 messages
            if (this.conversationHistory.length > 10) {
                this.conversationHistory = this.conversationHistory.slice(-10);
            }

            // Speak the general response
            if (window.ttsService && window.ttsService.isAvailable() && window.ttsService.isEnabled) {
                await window.ttsService.speakAIResponse(aiResponse, 'general');
            }

            return {
                action: 'general_response',
                response: aiResponse,
                needs_clarification: false
            };
        } catch (error) {
            console.error('Error processing general command:', error);
            return {
                action: 'error',
                response: 'Sorry, I had trouble processing your request. Please try again.',
                needs_clarification: true
            };
        }
    }

    formatAppointmentDetails(parameters) {
        const details = [];
        if (parameters.client_name) details.push(`Client: ${parameters.client_name}`);
        if (parameters.date) details.push(`Date: ${parameters.date}`);
        if (parameters.time) details.push(`Time: ${parameters.time}`);
        if (parameters.provider) details.push(`Provider: ${parameters.provider}`);
        if (parameters.duration) details.push(`Duration: ${parameters.duration} minutes`);
        return details.join('\n');
    }

    async executeCalendarAction(actionData) {
        // This would integrate with the main calendar functions
        // For now, we'll just log the action - the UI will handle the actual execution
        console.log('Voice command action:', actionData);
        
        // Dispatch custom event for the main app to handle
        window.dispatchEvent(new CustomEvent('voiceCalendarAction', {
            detail: actionData
        }));
    }
}

// Add continue conversation functionality to VoiceCalendarAssistant
VoiceCalendarAssistant.prototype.startContinueConversation = function() {
    console.log('Starting continue conversation mode');
    this.continueMode = true;
    
    // Use the main app's toggle function to avoid conflicts
    if (!this.isRecording && !this.isProcessing) {
        console.log('Starting recording for continue conversation');
        
        // Update UI to show we're in conversation mode
        const continueBtn = document.getElementById('continue-conversation-btn');
        if (continueBtn) {
            continueBtn.style.backgroundColor = '#4f46e5';
            continueBtn.style.color = 'white';
        }
        
        // Use the global toggle function to ensure proper state management
        if (typeof window.toggleVoiceRecording === 'function') {
            window.toggleVoiceRecording();
        } else if (typeof toggleVoiceRecording === 'function') {
            toggleVoiceRecording();
        } else {
            console.error('toggleVoiceRecording function not found');
            // Fallback - directly start recording
            this.startRecording();
        }
    } else {
        console.log('Cannot start recording - already recording or processing');
    }
};

// General command functionality is handled by the class method above









// Export the AI assistant instances
export const aiAssistant = new TherapyAIAssistant();
export const voiceAssistant = new VoiceCalendarAssistant();