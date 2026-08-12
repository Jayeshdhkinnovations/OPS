import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";

// This block is meant to be public - it identifies which Firebase project
// to talk to, not a secret. The actual protection is server-side: every
// token this produces gets independently re-verified against Firebase's own
// keys before anything is trusted (see firebaseAdmin.js on the backend).
const firebaseConfig = {
  apiKey: "AIzaSyDtmpCHeMtn7OkFcCfe-swYbYtpCZ-v9l4",
  authDomain: "signtoowix.firebaseapp.com",
  projectId: "signtoowix",
  storageBucket: "signtoowix.firebasestorage.app",
  messagingSenderId: "709578275861",
  appId: "1:709578275861:web:6e63851e070dccd0ba621c",
  measurementId: "G-C0M2V3VR9S"
};

const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
const googleProvider = new GoogleAuthProvider();

// Opens Google's account picker and returns a Firebase ID token for
// whichever account the user chooses. This token is what every
// Google-related cloud function (googleloginlookup, googlelogin,
// submitapprovalgoogle) expects as `idToken`.
export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user.getIdToken();
}
