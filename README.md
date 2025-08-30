# Therapy Calendar Application

## Quick Start Guide

This is a complete AI-powered therapy scheduling application with voice assistant capabilities.

### What's Included
- Interactive calendar with drag-and-drop scheduling
- Client management system
- Voice assistant for natural language scheduling
- Multi-provider support with color-coded appointments
- Real-time Firebase database integration
- OpenAI-powered AI features

### Setup Instructions

1. **Extract the files** to your desired folder
2. **Open Firebase Console** (https://console.firebase.google.com/)
   - Create a new project or use existing one
   - Enable Firestore Database
   - **Enable Authentication** with Email/Password and Google providers
   - **Important for Google Sign-In**: Add your domain to authorized domains:
     - Go to Authentication → Settings → Authorized domains
     - Add your deployment domain (e.g., your-app.replit.app)
     - For local testing, localhost is already included
   - Get your Firebase configuration
3. **Get API Keys:**
   - OpenAI API key from https://platform.openai.com/
   - (Optional) ElevenLabs API key for text-to-speech
4. **Configure Environment:**
   - Run `python3 process_config.py` in terminal
   - Or manually edit `firebase-config.js` with your Firebase settings
5. **Start the application:**
   - Run: `python3 process_config.py && python -m http.server 5000`
   - Open browser to: http://localhost:5000
6. **First Time Setup:**
   - Visit login page and create your account
   - Sign in to access the therapy calendar

### Features

#### Voice Assistant
- Click the microphone button (with golden star indicator)
- Say commands like:
  - "Schedule John for tomorrow at 2 PM"
  - "Cancel Friday's appointment"
  - "Tell me about LeBron James" (general knowledge)

#### Calendar Views
- Month, Week, Day, and List views
- Drag appointments to reschedule
- Click appointments to view/edit details
- Color-coded by client

#### Client Management
- Add/edit clients in the sidebar
- Assign custom colors
- Track session notes and history

### Technical Requirements
- Modern web browser
- Python 3.x (for local server)
- Internet connection (for Firebase and AI features)

### Configuration Files
- `firebase-config.js` - Database connection settings
- `process_config.py` - Environment setup helper
- `index.html` - Main application interface
- `app.js` - Core application logic
- `ai-assistant.js` - Voice and AI functionality

### Support
This application uses:
- Firebase Firestore for data storage
- OpenAI GPT-4o for AI features
- FullCalendar for scheduling interface
- ElevenLabs for text-to-speech (optional)

For technical support, refer to the documentation in each JavaScript file.

---
**Built with vanilla JavaScript and Firebase - No complex build process required!**