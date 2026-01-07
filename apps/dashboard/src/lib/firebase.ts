// src/lib/firebase.ts
"use client";

import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getFirestore,
  connectFirestoreEmulator,
  Firestore,
  initializeFirestore,
} from "firebase/firestore";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInAnonymously,
  type Auth,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBw3cNHg_v84YvK-So2W2ukT13uPsKC2Bc",
  authDomain: "tips-compass.firebaseapp.com",
  projectId: "tips-compass",
  storageBucket: "tips-compass.firebasestorage.app",
  messagingSenderId: "22185905608",
  appId: "1:22185905608:web:6ddb6f0811e5e119d844fd",
  measurementId: "G-Y428WFFY89",
};

declare global {
  var __FIREBASE_APP__: ReturnType<typeof getApp> | undefined;
  var __FIRESTORE__: Firestore | undefined;
  var __FIRESTORE_EMU_CONNECTED__: boolean | undefined;
  var __FIREBASE_AUTH__: Auth | undefined;
  var __FIREBASE_AUTH_READY__: Promise<void> | undefined;
  var __FIREBASE_AUTH_PERSISTENCE_SET__: boolean | undefined;
}

function getAppInstance() {
  if (typeof window === "undefined") {
    throw new Error("getDb() called on the server");
  }

  if (!globalThis.__FIREBASE_APP__) {
    globalThis.__FIREBASE_APP__ = getApps().length
      ? getApp()
      : initializeApp(firebaseConfig);
  }

  return globalThis.__FIREBASE_APP__;
}

function getAuthInstance() {
  const app = getAppInstance();
  if (!globalThis.__FIREBASE_AUTH__) {
    globalThis.__FIREBASE_AUTH__ = getAuth(app);
  }
  return globalThis.__FIREBASE_AUTH__;
}

export async function ensureAuth() {
  const auth = getAuthInstance();
  if (auth.currentUser) return;
  if (!globalThis.__FIREBASE_AUTH_READY__) {
    globalThis.__FIREBASE_AUTH_READY__ = (async () => {
      if (!globalThis.__FIREBASE_AUTH_PERSISTENCE_SET__) {
        try {
          await setPersistence(auth, browserLocalPersistence);
        } finally {
          globalThis.__FIREBASE_AUTH_PERSISTENCE_SET__ = true;
        }
      }
      await signInAnonymously(auth);
    })();
  }
  await globalThis.__FIREBASE_AUTH_READY__;
}

export function getDb(): Firestore {
  const useEmulator =
    process.env.NEXT_PUBLIC_FIREBASE_EMULATOR === "true" ||
    process.env.NODE_ENV === "development";

  const app = getAppInstance();

  if (!globalThis.__FIRESTORE__) {
    if (useEmulator) {
      globalThis.__FIRESTORE__ = initializeFirestore(app, {
        experimentalForceLongPolling: true,
        useFetchStreams: false,
      });
    } else {
      globalThis.__FIRESTORE__ = getFirestore(app);
    }
  }

  if (useEmulator && !globalThis.__FIRESTORE_EMU_CONNECTED__) {
    connectFirestoreEmulator(globalThis.__FIRESTORE__, "127.0.0.1", 8080);
    globalThis.__FIRESTORE_EMU_CONNECTED__ = true;
  }

  return globalThis.__FIRESTORE__;
}

export async function getAuthedDb(): Promise<Firestore> {
  const db = getDb();
  await ensureAuth();
  return db;
}
