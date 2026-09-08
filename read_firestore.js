import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAvp8BEeKZT7O3Xl7WoHkvZLLzAHPaAUvg",
  authDomain: "moctalegames.firebaseapp.com",
  projectId: "moctalegames",
  storageBucket: "moctalegames.firebasestorage.app",
  messagingSenderId: "505303321049",
  appId: "1:505303321049:web:cccb4824369cc9f3c531c8",
  measurementId: "G-YSL713360T"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function check() {
  try {
    const usersSnap = await getDocs(collection(db, 'lorehaven_users'));
    console.log("Users count:", usersSnap.size);
    for (const userDoc of usersSnap.docs) {
      console.log("User:", userDoc.id);
      const dataSnap = await getDocs(collection(db, 'lorehaven_users', userDoc.id, 'data'));
      for (const d of dataSnap.docs) {
        console.log("  Doc:", d.id);
        if (d.id === 'library') {
          const games = d.data().games || [];
          console.log("    Games in library:", games.length);
          games.forEach(g => {
            console.log(`      - [${g.id}] ${g.name}`);
          });
        }
      }
    }
  } catch (err) {
    console.error(err);
  }
}

check();
