import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getMessaging } from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyCXtJRO1oyKhpfBJfL_dmUkdi_bCIX1Vlw",
  authDomain: "my-task-app-by-claude.firebaseapp.com",
  projectId: "my-task-app-by-claude",
  storageBucket: "my-task-app-by-claude.firebasestorage.app",
  messagingSenderId: "530413659349",
  appId: "1:530413659349:web:b0e6765d2e3eaf4e642e5c"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
// Googleカレンダー読み取り用スコープ（読み取り専用。Firestoreへの書き込みなし）
provider.addScope("https://www.googleapis.com/auth/calendar.readonly");
// 毎回アカウント選択を出してアクセストークンを確実に取得する
provider.setCustomParameters({ prompt: "select_account" });
export const db = getFirestore(app);
export const messaging = getMessaging(app);
