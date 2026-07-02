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
        
        const fullText = fs.readFileSync(filePath, 'utf8');
        if (!fullText) throw new Error("ไฟล์ว่างเปล่า");

        // ---------------------------------------------------------
        // ✂️ ใช้การ Split หั่นตามเครื่องหมาย ****** ที่มีอยู่ในไฟล์ 
        // ---------------------------------------------------------
        const rawChunks = fullText.split('******');
        
        // ลบช่องว่างหัวท้าย และกรองก้อนที่ว่างเปล่าออก
        const chunks = rawChunks
            .map(chunk => chunk.trim())
            .filter(chunk => chunk.length > 0);

        console.log(`✂️ แบ่งข้อมูลตามหัวข้อได้ ${chunks.length} ส่วน`);

        const fileName = path.basename(filePath);

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
                    source: fileName,
                    type: 'semantic_import', // เปลี่ยน tag ให้รู้ว่านี่คือไฟล์ที่หั่นตามหัวข้อ
                    imported_at: new Date().toISOString()
                }
            });

            if (error) console.error(`🔴 Error chunk ${i+1}:`, error.message);
            else console.log(`   ✅ บันทึกก้อนข้อมูลที่ ${i + 1}/${chunks.length} สำเร็จ`);
        }
        console.log(`🎉 เสร็จสิ้นไฟล์: ${fileName}`);

    } catch (err) {
        console.error(`🔴 เกิดข้อผิดพลาดกับไฟล์ ${filePath}:`, err.message);
    }
}

// ฟังก์ชันแบบใหม่ (มี Overlap) ป้องกันคำตอบแหว่ง
function chunkText(text, size, overlap) {
    const chunks = [];
    let i = 0;
    while (i < text.length) {
        let end = i + size;
        if (end < text.length) {
            const lastSpace = text.lastIndexOf(' ', end);
            const lastNewline = text.lastIndexOf('\n', end);
            const safeCut = Math.max(lastSpace, lastNewline);
            if (safeCut > i) end = safeCut;
        }
        chunks.push(text.slice(i, end).trim());
        i = end - overlap; 
        if (i <= chunks.length * (size - overlap) && chunks.length > 0) {}
    }
    return chunks;
}

// --- ฟังก์ชันใหม่สำหรับอ่านทั้งโฟลเดอร์ ---
async function importAllFromDirectory(dirPath) {
    try {
        // อ่านรายชื่อไฟล์ทั้งหมดในโฟลเดอร์
        const files = fs.readdirSync(dirPath);
        
        // กรองเอาเฉพาะไฟล์นามสกุล .txt
        const txtFiles = files.filter(file => file.endsWith('.txt'));
        
        if (txtFiles.length === 0) {
            console.log(`⚠️ ไม่พบไฟล์ .txt ในโฟลเดอร์ ${dirPath}`);
            return;
        }

        console.log(`📁 พบไฟล์ .txt ทั้งหมด ${txtFiles.length} ไฟล์ กำลังเริ่มกระบวนการ...`);

        // ใช้ for...of loop ร่วมกับ await เพื่อประมวลผลทีละไฟล์ 
        // (ป้องกันการยิง Request ไปหา Hugging Face หรือ Supabase พร้อมกันมากเกินไปจนโดนแบน / Timeout)
        for (const file of txtFiles) {
            const fullPath = path.join(dirPath, file);
            console.log(`\n========================================`);
            await importFromText(fullPath);
        }

        console.log(`\n✅🎉 นำเข้าข้อมูลทั้งหมด ${txtFiles.length} ไฟล์ เข้าสู่ Database เรียบร้อยแล้ว!`);
    } catch (err) {
        console.error('🔴 เกิดข้อผิดพลาดในการอ่านโฟลเดอร์:', err.message);
    }
}

// ระบุ Path โฟลเดอร์ที่เก็บไฟล์ .txt ของคุณ
const targetDirectory = './knowledge_docs'; 
importAllFromDirectory(targetDirectory);