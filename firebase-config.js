// ══════════════════════════════════════════════════════════
// Firebase configuration for Jonas Geografi
// ══════════════════════════════════════════════════════════
// To set up:
// 1. Go to https://console.firebase.google.com
// 2. Create a new project (e.g. "jonas-geografi")
// 3. Go to Project Settings > General > Your apps > Add web app
// 4. Copy the config values below
// 5. Go to Realtime Database > Create Database
// 6. Set the security rules to:
//    {
//      "rules": {
//        "highscores": {
//          "$region": {
//            ".read": true,
//            ".write": true,
//            "$entry": {
//              ".validate": "newData.hasChildren(['name','score','time','wrong','date'])
//                            && newData.child('name').isString()
//                            && newData.child('name').val().length <= 20
//                            && newData.child('score').isNumber()
//                            && newData.child('time').isNumber()
//                            && newData.child('wrong').isNumber()
//                            && newData.child('date').isNumber()"
//            }
//          }
//        }
//      }
//    }
// ══════════════════════════════════════════════════════════

const FIREBASE_CONFIG = {
  apiKey: "PLACEHOLDER",
  authDomain: "PLACEHOLDER.firebaseapp.com",
  databaseURL: "https://PLACEHOLDER-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "PLACEHOLDER",
  storageBucket: "PLACEHOLDER.appspot.com",
  messagingSenderId: "000000000000",
  appId: "0:000000000000:web:0000000000000000000000"
};

// Initialize Firebase (only if configured)
let firebaseDB = null;
if (FIREBASE_CONFIG.apiKey !== "PLACEHOLDER") {
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    firebaseDB = firebase.database();
    console.log("Firebase connected");
  } catch (e) {
    console.warn("Firebase init failed, using local storage:", e);
  }
}
