const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { HfInference } = require("@huggingface/inference");
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const hf = new HfInference(process.env.HF_TOKEN);

async function importFromText(filePath) {
    try {
        console.log(`📂 กำลังอ่านไฟล์ข้อความ: ${filePath}`);
        
        // อ่านไฟล์ Text 直接 (ไม่มี Library PDF มาเกี่ยว)
        const fullText = fs.readFileSync(filePath, 'utf8');

        if (!fullText) throw new Error("ไฟล์ว่างเปล่า");

        // แบ่งท่อน (Chunking)
        const chunks = chunkText(fullText, 1000);
        console.log(`✂️ แบ่งข้อมูลได้ ${chunks.length} ส่วน`);

        for (let i = 0; i < chunks.length; i++) {
            const content = chunks[i];

            // ทำ Embedding
            const embeddingResult = await hf.featureExtraction({
                model: 'intfloat/multilingual-e5-base',
                inputs: content
            });

            // บันทึกลง Supabase
            const { error } = await supabase.from('university_vectors').insert({
                content: content,
                embedding: embeddingResult,
                metadata: {
                    source: '68newloan.pdf', // ใส่ชื่อเดิมไว้เพื่ออ้างอิง
                    type: 'manual_import',
                    imported_at: new Date().toISOString()
                }
            });

            if (error) console.error(`🔴 Error chunk ${i+1}:`, error.message);
            else console.log(`✅ บันทึกส่วนที่ ${i + 1}/${chunks.length} สำเร็จ`);
        }
        console.log('🎉 เสร็จสิ้น! ข้อมูลเข้า Database เรียบร้อย');

    } catch (err) {
        console.error('🔴 เกิดข้อผิดพลาด:', err.message);
    }
}

function chunkText(text, size) {
    const chunks = [];
    for (let i = 0; i < text.length; i += size) {
        chunks.push(text.slice(i, i + size));
    }
    return chunks;
}

importFromText('./data.txt');