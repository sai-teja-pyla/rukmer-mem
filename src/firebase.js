// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";

// The Single Config for 'rukmer-saas'
const firebaseConfig = {
  // ⚠️ PASTE THE KEYS FROM 'rukmer-saas' HERE
  apiKey: "AIzaSyBTGinN2ztdI9ToL75HGe_2zKssFM-RR7A",
  authDomain: "rukmer-saas.firebaseapp.com",
  projectId: "rukmer-saas",
  storageBucket: "rukmer-saas-data",
  messagingSenderId: "361739908342",
  appId: "1:361739908342:web:dca4e1491aa36aca11a8d7",
  measurementId: "G-1XG5ZEVHB4"
};

// Initialize ONE app
const app = initializeApp(firebaseConfig);

// Export services
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const storage = getStorage(app);
export const db = getFirestore(app);
export const analytics = getAnalytics(app);