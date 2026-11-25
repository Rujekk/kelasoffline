// Firebase bootstrap for KelasOffline.
//
// Services used (and nothing else):
//  - AI Logic (firebase/ai) with the Gemini Developer API backend — hybrid
//    on-device / cloud inference.
//  - App Check — enforced for AI Logic by the console setup. This demo uses
//    the App Check debug provider: a fixed demo token is registered in the
//    Firebase console (App Check > Apps > Manage debug tokens), a pattern the
//    #BuildHybridAI rules explicitly accept.
//  - Authentication (anonymous) — separates each learner's history without
//    any sign-up friction.
//  - Firestore — study history, with persistent local cache so history reads
//    and writes queue gracefully while offline.

import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { getAI, GoogleAIBackend } from "firebase/ai";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);

// App Check must be initialized before AI Logic calls. In debug-token mode
// the provider is never invoked — the registered debug token is exchanged
// directly (see the official App Check debug-provider docs).
if (import.meta.env.VITE_APPCHECK_DEBUG_TOKEN) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
}
initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider("kelasoffline-demo-debug-provider"),
  isTokenAutoRefreshEnabled: true,
});

export const ai = getAI(app, { backend: new GoogleAIBackend() });

export const auth = getAuth(app);

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// Resolves with the anonymous user's uid once signed in.
export const uidReady = new Promise((resolve, reject) => {
  const unsub = onAuthStateChanged(auth, (user) => {
    if (user) {
      unsub();
      resolve(user.uid);
    }
  });
  signInAnonymously(auth).catch((err) => {
    unsub();
    reject(err);
  });
});
