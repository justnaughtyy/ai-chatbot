// delete_logs.js
const { Firestore } = require('@google-cloud/firestore');

// --- ‼️ ตรวจสอบว่า Path นี้ถูกต้อง ‼️ ---
const projectId = 'unichatbot56';
const keyFilename = './unichatbot56-e74c2bbcbdc8.json';
// ------------------------------------

const firestore = new Firestore({ projectId, keyFilename });
const collectionRef = firestore.collection('chat_logs');
const batchSize = 100; // ลบทีละ 100 เอกสาร

async function deleteCollection() {
  console.log(`🔥 Starting deletion of "chat_logs" collection...`);

  let query = collectionRef.limit(batchSize);
  let snapshot = await query.get();
  let deletedCount = 0;

  while (snapshot.size > 0) {
    const batch = firestore.batch();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    deletedCount += snapshot.size;
    console.log(`   ... deleted ${deletedCount} documents.`);

    // เตรียม query รอบต่อไป
    snapshot = await query.get();
  }

  console.log(`✅ Finished deleting ${deletedCount} documents from "chat_logs".`);
}

// --- ‼️ คำเตือน ‼️ ---
// รันฟังก์ชันนี้เมื่อคุณ "แน่ใจ" เท่านั้น
console.log("‼️ WARNING: This script will permanently delete ALL documents in the 'chat_logs' collection in 5 seconds.");
console.log("Press Ctrl+C to cancel.");
setTimeout(() => {
    deleteCollection().catch(err => {
        console.error("🔴 Error deleting collection:", err);
    });
}, 5000); // หน่วงเวลา 5 วินาทีให้คุณกดยกเลิก