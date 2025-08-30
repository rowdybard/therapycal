// Firebase configuration and initialization
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';

// Firebase configuration using environment variables
const firebaseConfig = {
    apiKey: "AIzaSyDYPw1Z1-9JDdwhYxIroDwivqX1T4i-QPY",
    authDomain: "therapy-calendar-73429.firebaseapp.com",
    projectId: "therapy-calendar-73429",
    storageBucket: "therapy-calendar-73429.firebasestorage.app",
    messagingSenderId: "1079107096070",
    appId: "1:1079107096070:web:d2ff0eb7335600d8693d87"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore
const db = getFirestore(app);

// Initialize Firebase Auth
const auth = getAuth(app);

// Export for use in other modules
// Set up OpenAI API key for browser environment
if (typeof window !== 'undefined') {
    // Configure OpenAI API key from environment variables
    window.OPENAI_API_KEY = window.OPENAI_API_KEY || 
                            (typeof process !== 'undefined' && process.env ? process.env.OPENAI_API_KEY : null);
}

export { db, auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup };
