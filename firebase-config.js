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
//        },
//        "highfives": {
//          ".read": true,
//          ".write": true,
//          ".validate": "newData.isNumber()"
//        }
//      }
//    }
// ══════════════════════════════════════════════════════════

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD2CiEcucG6uwotMkxHo_VTqtrDLKx0qlo",
  authDomain: "geography-fa6a4.firebaseapp.com",
  databaseURL: "https://geography-fa6a4-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "geography-fa6a4",
  storageBucket: "geography-fa6a4.firebasestorage.app",
  messagingSenderId: "166752282053",
  appId: "1:166752282053:web:7406ec73f7f702210217ac"
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
