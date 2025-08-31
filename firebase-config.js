// Firebase configuration and initialization
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';

// Firebase configuration (prefer environment variables, fallback to defaults)
const defaultFirebaseConfig = {
    apiKey: "AIzaSyDYPw1Z1-9JDdwhYxIroDwivqX1T4i-QPY",
    authDomain: "therapy-calendar-73429.firebaseapp.com",
    projectId: "therapy-calendar-73429",
    storageBucket: "therapy-calendar-73429.firebasestorage.app",
    messagingSenderId: "1079107096070",
    appId: "1:1079107096070:web:d2ff0eb7335600d8693d87"
};

// Read runtime-provided config from env.js if present
function resolveFirebaseConfig() {
    let config = { ...defaultFirebaseConfig };
    try {
        if (typeof window !== 'undefined') {
            // Allow either object or JSON string for FIREBASE_CONFIG
            let envConfig = window.FIREBASE_CONFIG;
            if (typeof envConfig === 'string') {
                try { envConfig = JSON.parse(envConfig); } catch (_) { /* ignore parse error */ }
            }
            if (envConfig && typeof envConfig === 'object') {
                config = { ...config, ...envConfig };
            }

            // Warn if service account is provided to the browser (not safe to use client-side)
            if (window.FIREBASE_SERVICE_ACCOUNT) {
                console.warn('FIREBASE_SERVICE_ACCOUNT detected in client. Do not expose service account credentials in the browser. Use FIREBASE_CONFIG (client Web API config) instead.');
            }
        }
    } catch (e) {
        console.warn('Unable to read Firebase env configuration, using defaults.', e);
    }
    return config;
}

const firebaseConfig = resolveFirebaseConfig();

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore
const db = getFirestore(app);

// Initialize Firebase Auth
const auth = getAuth(app);

export { db, auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup };
