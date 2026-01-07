// src/lib/firebase.ts
"use client";

import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getFirestore,
  connectFirestoreEmulator,
  Firestore,
  initializeFirestore,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ?? "",
};

declare global {
  var __FIREBASE_APP__: ReturnType<typeof getApp> | undefined;
  var __FIRESTORE__: Firestore | undefined;
  var __FIRESTORE_EMU_CONNECTED__: boolean | undefined;
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

export function getDb(): Firestore {
  const useEmulator =
    process.env.NEXT_PUBLIC_FIREBASE_EMULATOR === "true" ||
    process.env.NODE_ENV === "development";

  const app = getAppInstance();

  if (!globalThis.__FIRESTORE__) {
    if (useEmulator) {
      globalThis.__FIRESTORE__ = initializeFirestore(app, {
        experimentalForceLongPolling: true,
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
  return getDb();
}
