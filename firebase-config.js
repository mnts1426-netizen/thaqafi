// إعداد Firebase - نسخة احتياطية سحابية تلقائية لحالة الدوري (Firestore)
const firebaseConfig = {
  apiKey: "AIzaSyB20t4wW_wU41vGVGCX6sa7pBMyOxqtUKA",
  authDomain: "thaqafi-8960c.firebaseapp.com",
  projectId: "thaqafi-8960c",
  storageBucket: "thaqafi-8960c.firebasestorage.app",
  messagingSenderId: "625448063980",
  appId: "1:625448063980:web:ee4c7ab7c75b1e0b6866c9",
  measurementId: "G-B5GMB6CCFL",
};

let firebaseDb = null;
try {
  firebase.initializeApp(firebaseConfig);
  firebaseDb = firebase.firestore();
} catch (e) {
  console.error("تعذّر تهيئة Firebase - سيعمل البرنامج محليًا فقط بدون نسخة احتياطية سحابية", e);
}
