import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCTtKUiMS1eByd_ttHBkTF13S7EDggXvmg",
  authDomain: "datalake-production-sa.firebaseapp.com",
  projectId: "datalake-production-sa",
  storageBucket: "datalake-production-sa.firebasestorage.app",
  messagingSenderId: "808056940626",
  appId: "1:808056940626:web:7aee4d64f616554c39d78b",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const users = [
  { name: 'Mohammed Alqumri', email: 'm.alqumri@datalake.sa', job_title: 'CEO', role_id: 'ceo' },
  { name: 'Finance Team', email: 'finance@datalake.sa', job_title: 'Accountant', role_id: 'finance' },
  { name: 'Ayham Ramadan', email: 'ayh.ashraf@datalake.sa', job_title: 'Data Architect', role_id: 'engineer' },
  { name: 'Mahmoud Abdelghany', email: 'mah.abdelghany@datalake.sa', job_title: 'Data Protection Eng.', role_id: 'engineer' },
  { name: 'Mohamed Dahas', email: 'moh.dahas@datalake.sa', job_title: 'Sr. Data Engineer', role_id: 'engineer' },
  { name: 'Marwen Benalayat', email: 'mar.benalayat@datalake.sa', job_title: 'Data Engineer', role_id: 'engineer' },
  { name: 'Salaheddine Gragba', email: 'Saleh.Gragba@datalake.sa', job_title: 'Data Scientist', role_id: 'engineer' },
  { name: 'Marwan Ayoub', email: 'mar.ayoub@datalake.sa', job_title: 'BI Engineer', role_id: 'engineer' },
  { name: 'Alaa Alkattan', email: 'Alaa.Alkattan@datalake.sa', job_title: 'AI Business Director', role_id: 'engineer' },
  { name: 'Bassam Soliman', email: 'Bassam.soliman@datalake.sa', job_title: 'Technical Director', role_id: 'engineer' },
  { name: 'Mohamed Ashraf', email: 'Moh.ashraf@datalake.sa', job_title: 'Developer', role_id: 'engineer' },
  { name: 'Mahmoud Aly Metawea', email: 'Mah.Metawea@datalake.sa', job_title: 'Sr. Developer', role_id: 'engineer' },
  { name: 'Hamdi Tebourbi', email: 'hamdi.tebourbi@datalake.sa', job_title: 'CTO', role_id: 'cto' },
  { name: 'HR Department', email: 'hr@datalake.sa', job_title: 'HR Manager', role_id: 'hr' }
];

async function run() {
  for (const user of users) {
    const id = user.email.replace('@', '_').replace('.', '_');
    await setDoc(doc(db, 'users', id), {
      email: user.email,
      name: user.name,
      role: user.role_id,
      job_title: user.job_title,
      created_at: new Date().toISOString()
    });
    console.log(`Created ${user.email} -> ${user.role_id}`);
  }
  console.log("Onboarding complete!");
  process.exit(0);
}

run().catch(console.error);
