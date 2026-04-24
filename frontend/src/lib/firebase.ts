import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";

// ‼️ วาง firebaseConfig ที่คุณคัดลอกมาทับตรงนี้ ‼️
const firebaseConfig = {
    apiKey: "AIzaSyAH6pDXkaHX-o_boPaR_zu-4GHcKYniqnI",
    authDomain: "unichatbot56.firebaseapp.com",
    projectId: "unichatbot56",
    storageBucket: "unichatbot56.firebasestorage.app",
    messagingSenderId: "852480329711",
    appId: "1:852480329711:web:b1a400505e3cfbe5f5981a",
    measurementId: "G-L1ZX6SQ9D5"
};

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);

export { app, auth };