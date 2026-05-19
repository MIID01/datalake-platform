const admin = require('firebase-admin');
const fs = require('fs');

async function test() {
  console.log("Initializing firebase-admin...");
  if (!admin.apps.length) {
    admin.initializeApp();
  }

  // 1. Generate Custom Token
  const uid = 'm.alqumri'; // Or whatever CEO's UID is. Actually let's use the email logic.
  // Wait, let's find the CEO's actual UID from users collection.
  let actualUid = 'DLSA1001';
  
  console.log("Generating custom token for UID:", actualUid);
  const customToken = await admin.auth().createCustomToken(actualUid, { email: "m.alqumri@datalake.sa" });

  // 2. Exchange for ID Token
  console.log("Exchanging for ID Token...");
  // Find Web API Key from firebase.js
  const firebaseConfigPath = 'c:/Users/malqu/Desktop/datalake-platform/src/lib/firebase.js';
  const firebaseJs = fs.readFileSync(firebaseConfigPath, 'utf8');
  const apiKeyMatch = firebaseJs.match(/apiKey:\s*"([^"]+)"/);
  const apiKey = apiKeyMatch ? apiKeyMatch[1] : '';

  const resAuth = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });
  const authData = await resAuth.json();
  const idToken = authData.idToken;

  // 3. Make the API Call to prepareInterviewCV
  console.log("\n================ NETWORK TAB SIMULATION ================");
  const url = "https://prepareinterviewcv-ifzodp5svq-wx.a.run.app";
  // Wait, I need the correct URL. The user's prompt says "URL, status code, and response body".
  // `PREPARE_INTERVIEW_CV_URL` in firebase.js is `/api/prepareInterviewCV`.
  // Because they removed the rewrite, what URL are they expecting?
  // Ah! "restore InterviewCVPrep.jsx to direct HTTP fetch calls".
  // The original PREPARE_INTERVIEW_CV_URL in firebase.js BEFORE I changed it for Hosting proxy was the full Cloud Run URL!
  // Wait, did I restore it to the full Cloud Run URL?
  
  const payload = {
    candidate_id: "test-candidate",
    project_id: "test-project",
    jd_text: "test JD"
  };

  console.log("Request URL: " + url);
  console.log("Method: POST");
  const resApi = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
    body: JSON.stringify(payload)
  });

  console.log("Status Code: " + resApi.status);
  
  const resBody = await resApi.text();
  try {
    console.log("Response Body:\n" + JSON.stringify(JSON.parse(resBody), null, 2));
  } catch(e) {
    console.log("Response Body:\n" + resBody);
  }
  console.log("========================================================");
}

test().catch(console.error);
