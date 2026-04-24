require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { Firestore } = require('@google-cloud/firestore');
const { HfInference } = require("@huggingface/inference");

// --- ตั้งค่า ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const firestore = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT_ID, keyFilename: './unichatbot56-e74c2bbcbdc8.json' }); // ‼️ CHECK FILENAME
const hf = new HfInference(process.env.HF_TOKEN);
const embeddingModelName = 'intfloat/multilingual-e5-base';
// const embeddingModelName = 'intfloat/multilingual-e5-large';

async function indexData() {
  console.log("Starting Hugging Face indexing process (Debug Mode)...");
  console.log("Clearing old data from Supabase...");
  const { error: deleteError } = await supabase.from('university_vectors').delete().neq('id', 0);
  if (deleteError) { console.error('Error clearing old data:', deleteError); return; }
  console.log("Old data cleared.");

  const documentsSnapshot = await firestore.collection('university_documents').get();

  for (const doc of documentsSnapshot.docs) {
    const { topic, content } = doc.data();
    console.log(`\nProcessing: ${topic}`);

    try {
      // --- สร้าง Embedding ด้วย Hugging Face ---
      const embeddingResult = await hf.featureExtraction({
        model: embeddingModelName,
        inputs: content
      });

      // --- ติดกล้อง: ดูหน้าตาผลลัพธ์จริงๆ ---
      console.log(`  > Raw embedding result from HF:`, JSON.stringify(embeddingResult, null, 2));
      // --- จบส่วนติดกล้อง ---

      // --- ลองแกะห่อแบบต่างๆ ---
      let vector = null;
      if (Array.isArray(embeddingResult) && embeddingResult.length > 0 && Array.isArray(embeddingResult[0]) && typeof embeddingResult[0][0] === 'number') {
        // กรณีที่ผลลัพธ์เป็น [[1, 2, 3, ...]] (Nested Array)
        vector = embeddingResult[0];
        console.log("  > Extracted vector (assuming nested array format).");
      } else if (Array.isArray(embeddingResult) && typeof embeddingResult[0] === 'number') {
        // กรณีที่ผลลัพธ์เป็น [1, 2, 3, ...] (Flat Array)
        vector = embeddingResult;
        console.log("  > Extracted vector (assuming flat array format).");
      } else {
        console.error("  > Unexpected embedding format received. Cannot extract vector.");
        // ลอง Log อีกครั้งเผื่อกรณี object ที่ซับซ้อน
        console.error("  > Full HF Response Structure:", embeddingResult);
      }
      // --- จบการแกะห่อ ---


      if (!vector || !Array.isArray(vector) || vector.length !== 768) { // เพิ่มการเช็คขนาด Vector ด้วย
        throw new Error(`Invalid or unexpected embedding format/dimension received for "${topic}". Expected 384 dimensions.`);
      }

      console.log(`  > Embedding created successfully (Dimensions: ${vector.length}). Inserting into Supabase...`);
      const { error: insertError } = await supabase.from('university_vectors').insert({ content, embedding: vector });
      if (insertError) {
        console.error(`  > Error inserting "${topic}" into Supabase:`, insertError);
      } else {
        console.log(`  > Successfully indexed "${topic}"`);
      }
    } catch (processingError) { // เปลี่ยนชื่อตัวแปร error ไม่ให้ซ้ำ
      console.error(`  > FAILED to process embedding for "${topic}":`, processingError.message);
    }
  }
  console.log("\n--- Hugging Face Indexing finished! ---");
}

indexData();