const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const keepEmails = [
  'm.alqumri@datalake.sa',
  'mah.abdelghany@datalake.sa',
  'moh.dahas@datalake.sa',
  'mar.benalayat@datalake.sa',
  'saleh.gragba@datalake.sa',
  'khaled.mohamed13798@gmail.com',
  'mar.ayoub@datalake.sa',
  'enas.saeed@datalake.sa',
  'ayh.ashraf@datalake.sa',
  'mah.reda@datalake.sa'
];

async function cleanupUsers() {
  const usersSnap = await db.collection('users').get();
  let deletedCount = 0;
  let updatedCount = 0;

  const seenEmails = new Set();

  for (const doc of usersSnap.docs) {
    const data = doc.data();
    
    if (!data.email) {
      console.log(`Deleting ${doc.id} - No email field`);
      await doc.ref.delete();
      deletedCount++;
      continue;
    }
    
    const lowerEmail = data.email.toLowerCase();

    // Check for duplicates
    if (seenEmails.has(lowerEmail)) {
      console.log(`Deleting duplicate: ${lowerEmail} (uid: ${doc.id})`);
      await doc.ref.delete();
      deletedCount++;
      continue;
    }
    seenEmails.add(lowerEmail);

    // If we're keeping them, enforce lowercase email
    if (data.email !== lowerEmail) {
      console.log(`Updating ${data.email} to lowercase: ${lowerEmail}`);
      await doc.ref.update({ email: lowerEmail });
      updatedCount++;
    }
    
    // Update terminated status
    if (['enas.saeed@datalake.sa', 'ayh.ashraf@datalake.sa', 'mah.reda@datalake.sa'].includes(lowerEmail)) {
      if (data.status !== 'terminated') {
        console.log(`Updating ${lowerEmail} status to terminated`);
        await doc.ref.update({ status: 'terminated' });
        updatedCount++;
      }
    } else {
      // Ensure others are active
      if (data.status !== 'active') {
        console.log(`Updating ${lowerEmail} status to active`);
        await doc.ref.update({ status: 'active' });
        updatedCount++;
      }
    }
  }

  console.log(`Cleanup complete. Deleted: ${deletedCount}, Updated: ${updatedCount}`);
}

cleanupUsers().catch(console.error);
