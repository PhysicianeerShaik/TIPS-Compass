// src/lib/firebase.ts
"use client";

import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getFirestore,
  connectFirestoreEmulator,
  Firestore,
} from "firebase/firestore";

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
}

export function getDb(): Firestore {
  if (typeof window === "undefined") {
    throw new Error("getDb() called on the server");
  }

  if (!globalThis.__FIREBASE_APP__) {
    globalThis.__FIREBASE_APP__ = getApps().length
      ? getApp()
      : initializeApp(firebaseConfig);
  }

  if (!globalThis.__FIRESTORE__) {
    globalThis.__FIRESTORE__ = getFirestore(globalThis.__FIREBASE_APP__);
  }

  if (
    process.env.NODE_ENV === "development" &&
    !globalThis.__FIRESTORE_EMU_CONNECTED__
  ) {
    connectFirestoreEmulator(globalThis.__FIRESTORE__, "127.0.0.1", 8080);
    globalThis.__FIRESTORE_EMU_CONNECTED__ = true;
  }

  return globalThis.__FIRESTORE__;
}
