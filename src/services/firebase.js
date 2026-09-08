import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

// TODO: Replace this placeholder config with your actual Firebase project config.
// You can get this from the Firebase Console (Project Settings -> General -> Your apps -> Web app).
const firebaseConfig = {
  apiKey: "AIzaSyAvp8BEeKZT7O3Xl7WoHkvZLLzAHPaAUvg",
  authDomain: "moctalegames.firebaseapp.com",
  projectId: "moctalegames",
  storageBucket: "moctalegames.firebasestorage.app",
  messagingSenderId: "505303321049",
  appId: "1:505303321049:web:cccb4824369cc9f3c531c8",
  measurementId: "G-YSL713360T"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Request extra scopes if necessary, e.g., to read user's email
// googleProvider.addScope('profile');
// googleProvider.addScope('email');

export { app, db, auth, googleProvider };
