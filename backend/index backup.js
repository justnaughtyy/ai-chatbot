// --- 1. IMPORT LIBRARIES & SETUP ---
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Firestore, Timestamp } = require('@google-cloud/firestore');
const Groq = require('groq-sdk');
const { createClient } = require('@supabase/supabase-js');
const { HfInference } = require("@huggingface/inference");
// const AbortController = require('node-abort-controller').AbortController;

const app = express();
app.use(cors());
app.use(express.json());

// --- 2. CONNECTIONS ---
const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
const keyFilename = './unichatbot56-e74c2bbcbdc8.json'; // ‼️ CHECK FILENAME
if (!projectId || !keyFilename || !process.env.GROQ_API_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !process.env.HF_TOKEN) {
    console.error("🔴 FATAL ERROR: Env vars missing."); process.exit(1);
}
let firestore, groq, supabase, hf;
// const embeddingModelName = 'intfloat/multilingual-e5-large';
// const EXPECTED_DIMENSION = 1024;
const embeddingModelName = 'intfloat/multilingual-e5-base';
const EXPECTED_DIMENSION = 768;
try {
    firestore = new Firestore({ projectId, keyFilename });
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    hf = new HfInference(process.env.HF_TOKEN);
    console.log(`✅ Initialized external services (HF Embeddings: ${embeddingModelName} - RAG V14).`);
} catch (initError) {
    console.error("🔴 FATAL ERROR initializing services:", initError);
    process.exit(1);
}

// --- 3. HELPER FUNCTION: Get Chat History (V33 - Room Aware) ---
async function getRecentChatHistory(roomId, limit = 3) { // <-- เปลี่ยน userId เป็น roomId
    console.log(`[HISTORY V33] Fetching up to ${limit} pairs for room: ${roomId}`);
    if (!roomId) {
        console.log("[HISTORY V33] No roomId provided, returning empty history.");
        return [];
    }
    try {
        // กรองด้วย roomId แทน userId
        const query = firestore.collection('chat_logs')
            .where('roomId', '==', roomId) // <-- กรองด้วย roomId
            .orderBy('timestamp', 'desc')
            .limit(limit);

        const snapshot = await query.get();
        if (snapshot.empty) {
            console.log(`[HISTORY V33] No history found for room.`);
            return [];
        }

        const history = [];
        snapshot.docs.reverse().forEach(doc => {
            const data = doc.data();
            if (data.userMessage) history.push({ role: 'user', content: data.userMessage.substring(0, 200) });
            if (data.botResponse) history.push({ role: 'assistant', content: data.botResponse.substring(0, 300) });
        });
        console.log(`[HISTORY V33] Found and formatted ${snapshot.size} pairs.`);
        return history;
    } catch (histError) {
        console.error("🔴 Error fetching chat history:", histError);
        return [];
    }
}

// --- 4. HELPER FUNCTION: Vector Search (Using E5 Large) ---
async function searchVectorDatabase(query, matchCount = 10, threshold = 0.70) {
    console.log(`[VECTOR V13] HF Multi-Search (e5-large) for: "${query}" (Count: ${matchCount}, Threshold: ${threshold})`);
    if (!hf || !supabase) {
        console.error("🔴 Vector Search Error: HF client or Supabase client not initialized.");
        return [];
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        console.warn(`⚠️ HF Embedding request timed out for query: "${query}"`);
        controller.abort();
    }, 60000); // 15s timeout

    try {
        console.log(`[VECTOR V13] Creating embedding...`);
        const embeddingResult = await hf.featureExtraction({ model: embeddingModelName, inputs: query }, { signal: controller.signal });
        clearTimeout(timeoutId);
        let query_embedding = null;
        if (Array.isArray(embeddingResult) && embeddingResult.length > 0 && Array.isArray(embeddingResult[0])) {
            query_embedding = embeddingResult[0];
        } else if (Array.isArray(embeddingResult)) {
            query_embedding = embeddingResult;
        }
        if (!query_embedding || !Array.isArray(query_embedding)) {
            console.error("🔴 HF Vector Search Error: Failed to create or extract embedding. Unexpected format:", JSON.stringify(embeddingResult));
            return [];
        }

        if (query_embedding.length !== EXPECTED_DIMENSION) {
            console.error(`🔴 HF Vector Search Error: Unexpected embedding dimension. Expected ${EXPECTED_DIMENSION}, Got ${query_embedding.length}.`);
            return [];
        }

        console.log(`[VECTOR V13] Searching Supabase (Dim: ${query_embedding.length})...`);
        const { data, error } = await supabase.rpc('match_documents', { query_embedding, match_threshold: threshold, match_count: matchCount });
        if (error) { console.error('🔴 Vector search RPC error:', error); return []; }

        if (data && data.length > 0) {
            console.log(`[VECTOR V13] Found ${data.length} doc(s). Similarities: [${data.map(d => d.similarity.toFixed(3)).join(', ')}]`);
            return data.map(item => ({ content: item.content, similarity: item.similarity }));
        } else { console.log('[VECTOR V13] No relevant docs found.'); return []; }
    } catch (e) {
        clearTimeout(timeoutId);
        // --- ‼️‼️ V33.7 DEBUG LOG START ‼️‼️ ---
        // Log ตัว Error จริงๆ ออกมาดูเสมอ
        console.error("🔴 Error occurred during HF vector search:", e);
        // --- ‼️‼️ V33.7 DEBUG LOG END ‼️‼️ ---

        if (e.name === 'AbortError') {
            console.error("   (Error name suggests it was a timeout or abort signal)");
            // return []; // ยังคง return [] เหมือนเดิม
        } else {
            console.error("   (Error was not an AbortError)");
            // return []; // ยังคง return [] เหมือนเดิม
        }
        return []; // คืนค่า Array ว่างเสมอเมื่อเกิด Error
    }
}

// --- 5. HELPER FUNCTION: Get Calendar Data (MODIFIED) ---
let calendarCache = null; // Cache for the calendar data object
let calendarStringCache = null; // Cache for the formatted string
let cacheTimestamp = 0;

async function getCalendarInfo() {
    const CACHE_DURATION = 1000 * 60 * 60; // 1 ชั่วโมง
    if (calendarCache && (Date.now() - cacheTimestamp < CACHE_DURATION)) {
        console.log("[CALENDAR V14] Using cached calendar data.");
        return { calendarData: calendarCache, calendarString: calendarStringCache };
    }
    console.log("[CALENDAR V14] Fetching new calendar data...");
    try {
        const doc = await firestore.collection('university_config').doc('academic_calendar').get();
        if (!doc.exists) {
            console.warn("⚠️ Cannot find 'academic_calendar' document.");
            return { calendarData: null, calendarString: "ไม่พบข้อมูลปฏิทิน" };
        }
        calendarCache = doc.data();
        cacheTimestamp = Date.now();

        // Format the calendar data into a string for the LLM
        const { semester_1_start, semester_1_end, semester_2_start, semester_2_end } = calendarCache;
        const formatDate = (ts) => ts.toDate().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' });

        calendarStringCache = `
        - ภาคเรียนที่ 1: เริ่ม ${formatDate(semester_1_start)} ถึง ${formatDate(semester_1_end)}
        - ภาคเรียนที่ 2: เริ่ม ${formatDate(semester_2_start)} ถึง ${formatDate(semester_2_end)}
        `;
        console.log("[CALENDAR V14] Calendar data cached.");
        return { calendarData: calendarCache, calendarString: calendarStringCache.trim() };

    } catch (error) {
        console.error("🔴 Error fetching/processing calendar:", error);
        return { calendarData: null, calendarString: "เกิดข้อผิดพลาดในการดึงข้อมูลปฏิทิน" };
    }
}

// --- 5.5 (NEW V29) HELPER FUNCTION: NLU Extraction (Allowing Null Date) ---
async function getSearchContext(userMessage, recentHistory, currentTimeString, calendarData) {
    console.log(`[V18-HELPER V29] Analyzing query: "${userMessage}"`);

    const historyString = (recentHistory && recentHistory.length > 0)
        ? recentHistory.map(h => `${h.role}: ${h.content}`).join('\n')
        : "ไม่มีประวัติ";

    const isoSem1Start = calendarData.semester_1_start.toDate().toISOString().split('T')[0];
    const isoSem1End = calendarData.semester_1_end.toDate().toISOString().split('T')[0];
    const isoSem2Start = calendarData.semester_2_start.toDate().toISOString().split('T')[0];
    const isoSem2End = calendarData.semester_2_end.toDate().toISOString().split('T')[0];

    const machineCalendarString = `
- Semester 1: ${isoSem1Start} to ${isoSem1End}
- Semester 2: ${isoSem2Start} to ${isoSem2End}
`;

    // --- ‼️‼️ START V29 PROMPT FIX ‼️‼️ ---
    const systemPrompt = `คุณคือผู้เชี่ยวชาญด้านการวิเคราะห์คำค้นหา (Search Query Expert)
หน้าที่ของคุณคือทำ 3 อย่างพร้อมกัน และตอบเป็น JSON Object เท่านั้น:

1.  **Rewrite Query (standalone_query):**
    * อ่าน "ประวัติการสนทนา" และ "คำถามล่าสุด"
    * "เขียนคำถามล่าสุดใหม่" ให้เป็นประโยคที่สมบูรณ์ เข้าใจได้ในตัวเอง (Standalone Question)

2.  **Extract Topic (search_topic):**
    * จาก "Standalone Question" ให้ "สรุปหัวข้อหลัก" ที่ใช้สำหรับค้นหา (ตัดวันที่และเวลาออก)
    * (เช่น "วันที่ 8 พ.ย. 68 ห้องสมุดเปิดกี่โมง" -> "เวลาทำการห้องสมุด")

3.  **Extract Date (target_iso_date):**
    * วิเคราะห์ "Standalone Question" (ที่ได้จากข้อ 1) เพื่อหา "วันที่เป้าหมาย" ที่ผู้ใช้ถามถึง
    * "แปลง" วันที่เป้าหมายนั้นให้อยู่ในรูปแบบ "YYYY-MM-DD"
    * (ตัวอย่าง 1: "วันที่ 8 พฤศจิกายน 2568" -> "2025-11-08")
    * (ตัวอย่าง 2: "วันนี้" (จาก ${currentTimeString}) -> "2025-10-24")
    * **(สำคัญ!): ถ้าคำถามไม่ระบุวันที่เลย** (เช่น "ห้องสมุดเปิดกี่โมง" หรือ "ข้อมูล กยศ") ให้ตอบเป็น \`null\`

## ข้อมูลประกอบการวิเคราะห์
- เวลาปัจจุบัน: ${currentTimeString}
- ปฏิทิน (YYYY-MM-DD): ${machineCalendarString}

จงตอบเป็น JSON Object ที่มี key: "standalone_query", "search_topic", และ "target_iso_date" (เป็น YYYY-MM-DD หรือ null เท่านั้น)`;
    // --- ‼️‼️ END V29 PROMPT FIX ‼️‼️ ---


    const userPrompt = `
## ประวัติการสนทนา:
${historyString}

## คำถามล่าสุด:
${userMessage}

## ผลการวิเคราะห์ (JSON เท่านั้น):`;

    const fallbackResult = {
        standalone_query: userMessage,
        search_topic: userMessage.replace(/วันที่|เดือน|พ.ศ.|[0-9/]/g, '').trim(),
        target_iso_date: null // ‼️ V29 Fallback เป็น null
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        console.warn(`[V18-HELPER V29] Groq (70b) request timed out.`);
        controller.abort();
    }, 12000);

    try {
        const chatCompletion = await groq.chat.completions.create(
            { // อาร์กิวเมนต์ที่ 1: Body
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                model: 'llama-3.3-70b-versatile',
                temperature: 0.0,
                response_format: { type: "json_object" },
            },
            { // อาร์กิวเมนต์ที่ 2: Options
                signal: controller.signal
            }
        );

        clearTimeout(timeoutId);

        const jsonString = chatCompletion.choices[0]?.message?.content;
        if (jsonString) {
            try {
                const result = JSON.parse(jsonString);
                // --- ‼️‼️ V29 PARSE FIX ‼️‼️ ---
                // อนุญาตให้ target_iso_date เป็น null ได้
                if (result.standalone_query && result.search_topic && (typeof result.target_iso_date === 'string' || result.target_iso_date === null)) {
                    console.log(`[V18-HELPER V29] Standalone: "${result.standalone_query}", Topic: "${result.search_topic}", ISO_Date: ${result.target_iso_date}`);
                    return result;
                }
            } catch (parseError) {
                console.error("🔴 Error in getSearchContext (V29) JSON Parse:", parseError, "String:", jsonString);
                return fallbackResult;
            }
        }
        console.warn("[V18-HELPER V29] Failed to get valid JSON, using fallback.");
        return fallbackResult;

    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            console.error("🔴 Error in getSearchContext (V29): Timeout");
        } else {
            console.error("🔴 Error in getSearchContext (V29):", error);
        }
        return fallbackResult; // Fallback on error
    }
}

// --- 5.6 (NEW V25) HELPER FUNCTION: Deterministic Date Calculation ---
function calculateTimeInfo(target_iso_date, calendarData) {
    console.log(`[CALC V25] Calculating info for ISO Date: ${target_iso_date}`);
    try {
        // สร้าง Date object จาก ISO Date ที่ LLM สกัดมา
        // "2025-11-08" -> JS Date object (ระวัง timezone, แต่เราเทียบกับ 00:00 ก็พอ)
        const targetDate = new Date(target_iso_date + 'T00:00:00.000Z'); // ใช้ UTC เพื่อการเปรียบเทียบที่แน่นอน

        // 1. คำนวณ Timeframe
        let timeframe = "ช่วงปิดภาคเรียน"; // Default

        // แปลง Timestamp ของปฏิทินเป็น JS Date
        const sem1Start = calendarData.semester_1_start.toDate();
        const sem1End = calendarData.semester_1_end.toDate();
        const sem2Start = calendarData.semester_2_start.toDate();
        const sem2End = calendarData.semester_2_end.toDate();

        if ((targetDate >= sem1Start && targetDate <= sem1End) || (targetDate >= sem2Start && targetDate <= sem2End)) {
            timeframe = "ช่วงเปิดภาคเรียน";
        }

        // 2. คำนวณ DayType
        let day_type = "ไม่ระบุ";
        const dayOfWeek = targetDate.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
            day_type = "วันธรรมดา"; // จันทร์ - ศุกร์
        } else if (dayOfWeek === 0 || dayOfWeek === 6) {
            day_type = "วันหยุดสุดสัปดาห์"; // เสาร์ - อาทิตย์
        }

        console.log(`[CALC V25] Result -> Timeframe: "${timeframe}", DayType: "${day_type}"`);
        return { timeframe, day_type };

    } catch (error) {
        console.error("🔴 Error in calculateTimeInfo (V25):", error);
        return { timeframe: "ไม่ระบุช่วงเวลา", day_type: "ไม่ระบุ" }; // Fallback
    }
}

// --- 6. HELPER FUNCTION: Call Groq LLM (RAG V31 - The Multi-Doc Synthesizer) ---
async function callGroqLLM_RAG_V21_Synthesizer(userId, userMessage, retrievedDocs, recentHistory) { // <-- ชื่อฟังก์ชันยังเหมือนเดิม
    console.log(`🗣️ Calling Groq LLM (RAG V31 Synthesizer) with ${retrievedDocs.length} pre-filtered doc(s)...`); // <-- อัปเดต Log
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        console.warn(`⚠️ Groq LLM (V31) request timed out for user: ${userId}`);
        controller.abort();
    }, 15000);

    try {
        // --- ‼️‼️ START V31 PROMPT FIX ‼️‼️ ---
        const systemPrompt = `คุณคือ AI ผู้ช่วยสังเคราะห์ข้อมูลที่แม่นยำ
หน้าที่ของคุณคือตอบ "คำถามล่าสุด" โดยการ **สังเคราะห์คำตอบจาก "เอกสารข้อมูล" ที่เตรียมมาให้เท่านั้น**

ขั้นตอนการทำงาน:
1.  อ่าน "คำถามล่าสุด" (เช่น "เวลาทำการห้องสมุด")
2.  อ่าน "เอกสารข้อมูล" ทุกชิ้น
3.  **(สำคัญที่สุด!)** ถ้ามีเอกสารหลายชิ้น (เช่น เอกสาร 1: เปิดเทอม, เอกสาร 2: ปิดเทอม) คุณ "ต้อง" สังเคราะห์คำตอบโดย "รวมข้อมูล" จาก "ทุก" เอกสาร
    (ตัวอย่าง: "ช่วงเปิดเทอม เปิด... และช่วงปิดเทอม เปิด...")
4.  สร้างคำตอบโดย "สรุปความ" จากเอกสารทั้งหมดที่ได้รับ

ข้อห้าม (สำคัญมาก!):
- ห้ามอ้างอิงถึง "เอกสารข้อมูล" หรือ "ข้อมูลที่ค้นเจอ"
- ถ้าไม่เจอเอกสาร ให้ตอบว่า "ขออภัยค่ะ ฉันไม่มีข้อมูลในส่วนนี้"
- ตอบเป็นภาษาไทย กระชับ ชัดเจน`;
        // --- ‼️‼️ END V31 PROMPT FIX ‼️‼️ ---

        let contextString = "ไม่พบข้อมูล";
        if (retrievedDocs && retrievedDocs.length > 0) {
            contextString = retrievedDocs.map((doc, index) => `เอกสาร #${index + 1}:\n${doc.content.trim()}`).join('\n\n---\n\n');
        } else {
            console.log("   [V31] No documents provided after reranking.");
            clearTimeout(timeoutId);
            return "ขออภัยค่ะ ฉันไม่มีข้อมูลในส่วนนี้";
        }

        const historyString = recentHistory.map(h => `${h.role}: ${h.content}`).join('\n');

        const userPrompt = `
        ## เอกสารข้อมูล (สำหรับใช้สังเคราะห์คำตอบ "ทั้งหมด"):
        ${contextString}

        ## ประวัติการสนทนา (เพื่อทำความเข้าใจบริบท):
        ${historyString}

        ## คำถามล่าสุด (จากผู้ใช้):
        ${userMessage}
        
        ## คำตอบ (สังเคราะห์จาก "ทุก" เอกสารที่เกี่ยวข้อง):`;

        const messagesForGroq = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        const chatCompletion = await groq.chat.completions.create({
            messages: messagesForGroq,
            model: 'llama-3.1-8b-instant', // 8b ตัวเดิม
            temperature: 0.1
        }, { signal: controller.signal });

        clearTimeout(timeoutId);
        console.log("✅ Received response from Groq (RAG V31).");

        const potentialResponse = chatCompletion.choices[0]?.message?.content;

        if (potentialResponse && potentialResponse.trim() !== '') {
            let cleanedResponse = potentialResponse.trim();
            cleanedResponse = cleanedResponse.replace(/^คำตอบ:/i, '').trim();
            if (cleanedResponse === '*' || cleanedResponse === '-' || cleanedResponse === '•') return "ขออภัยค่ะ ฉันไม่มีข้อมูลในส่วนนี้";
            return cleanedResponse;
        } else {
            console.log(`⚠️ Groq returned empty (RAG V31). Fallback.`);
            return "ขออภัยค่ะ ฉันไม่มีข้อมูลในส่วนนี้";
        }
    } catch (groqError) {
        clearTimeout(timeoutId);
        if (groqError.name === 'AbortError') { return "ขออภัยค่ะ ระบบ AI ใช้เวลาประมวลผลนานเกินไป..."; }
        else { console.error("🔴 GROQ (V31) API ERROR:", groqError); return "ขออภัยค่ะ ตอนนี้ระบบ AI อัจฉริยะขัดข้องเล็กน้อย"; }
    }
}


// --- 7. MAIN API ENDPOINT (/api/chat) ---
app.post('/api/chat', async (req, res) => {
    console.log('\n--- [HANDLER START V14] ---');
    const startTime = Date.now();

    // โค้ดใหม่ V33:
    const { message, userId, roomId } = req.body; // <-- รับ roomId
    if (!message || !userId || !roomId) { // <-- ตรวจสอบ roomId ด้วย
        console.log("🔴 Request validation failed: Missing message, userId, or roomId.");
        return res.status(400).json({ error: 'Message, User ID, and Room ID are required' });
    }
    console.log(`[USER: ${userId}] [ROOM: ${roomId}] Message: "${message}"`);

    // --- ‼️ ดึงข้อมูลเวลาและปฏิทิน ‼️ ---
    const now = new Date();
    const currentTimeString = now.toLocaleString('th-TH', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok'
    });
    // --- ‼️ ดึงข้อมูลปฏิทิน (ทั้ง Object และ String) ‼️ ---
    const { calendarData, calendarString } = await getCalendarInfo(now);
    console.log(`[TIME] Current time: ${currentTimeString}`);
    console.log(`[CALENDAR] Calendar info loaded.`);
    // --- จบ ---

    let sessionClient;
    try {
        const dialogflow = require('@google-cloud/dialogflow');
        sessionClient = new dialogflow.SessionsClient({ projectId, keyFilename });
        console.log("✅ Dialogflow client created successfully.");
    } catch (dfError) {
        console.error("🔴 FATAL ERROR: Failed to create Dialogflow client:", dfError);
        return res.status(500).json({ error: 'Internal server error initializing Dialogflow' });
    }

    try {
        const sessionIdForDialogflow = userId;
        const sessionPath = sessionClient.projectAgentSessionPath(projectId, sessionIdForDialogflow);
        const request = {
            session: sessionPath,
            queryInput: { text: { text: message, languageCode: 'th-TH' } },
        };

        console.log("📡 Sending request to Dialogflow (V14)...");
        const responses = await sessionClient.detectIntent(request);
        const result = responses[0].queryResult;
        console.log("✅ Received response from Dialogflow (V14).");

        const intent = result.intent ? result.intent.displayName : 'Default Fallback Intent';
        console.log(`🧠 Detected Intent: ${intent} (via Dialogflow)`);

        let botResponse = null;
        let websiteUrl = null;

        // --- RAG-V14 LOGIC ---
        const simpleIntents = [
            'Default Welcome Intent',
            'Smalltalk - User - Thanks'
            // ‼️ ตรวจสอบให้แน่ใจว่าลบ Intent เก่าๆ ออกจาก Dialogflow หมดแล้ว ‼️
        ];

        // STEP 1: Handle simple intents
        if (simpleIntents.includes(intent)) {
            console.log(`⏳ Handling Simple Intent directly: ${intent}`);
            try {
                const query = firestore.collection('knowledge_base').where('intentName', '==', intent).limit(1);
                const snapshot = await query.get();
                if (!snapshot.empty) {
                    const data = snapshot.docs[0].data();
                    if (data.responses && data.responses.length > 0) {
                        botResponse = data.responses[Math.floor(Math.random() * data.responses.length)];
                        console.log(`   ✅ Found direct response in knowledge_base.`);
                    } else { botResponse = null; }
                } else { botResponse = null; }
            } catch (fsError) {
                console.error(`🔴 Error querying knowledge_base for intent "${intent}":`, fsError);
                botResponse = null;
            }
        }

        // STEP 2: Use RAG V32 (NLU -> Optional-Calculate -> Search -> Corrected 3-Way-Filter)
        if (botResponse === null) {
            console.log(`⏳ Intent "${intent}" requires RAG V32. Starting process...`);

            // --- ‼️ NEW V32 LOGIC START ‼️ ---

            // 1. ดึงประวัติแชท
            // โค้ดใหม่ V33:
            const recentHistory = await getRecentChatHistory(roomId); // <-- ส่ง roomId

            // 2. เรียก V29 Helper (70b) - (NLU)
            const { standalone_query, search_topic, target_iso_date } = await getSearchContext(
                message,
                recentHistory,
                currentTimeString,
                calendarData
            );

            // 3. (V29) คำนวณ (ถ้ามีวันที่ระบุมาเท่านั้น)
            let timeframe = "ไม่ระบุช่วงเวลา";
            let day_type = "ไม่ระบุ";

            if (target_iso_date) {
                console.log(`[RAG V32] Specific date detected (${target_iso_date}). Running calculation...`);
                ({ timeframe, day_type } = calculateTimeInfo(target_iso_date, calendarData));
            } else {
                console.log(`[RAG V32] No specific date detected (Broad Query).`);
            }

            // 4. ค้นหา Vector Database ด้วย "Search Topic"
            console.log(`[QUERY V32] Using Topic Search: "${search_topic}"`);
            let allRetrievedDocs = await searchVectorDatabase(search_topic, 10, 0.70);

            // 5. RERANKER V32 (Corrected Logic Order)
            if (allRetrievedDocs.length > 0) {

                if (timeframe === "ไม่ระบุช่วงเวลา") {
                    // --- 5A. BROAD QUERY (กว้าง - ไม่ระบุวันที่) ---
                    // (เช่น "ห้องสมุดเปิดกี่โมง" หรือ "ข้อมูล กยศ")
                    console.log(`[RERANK V32] Broad query detected. Checking for Evergreen status...`);

                    const bestDoc = allRetrievedDocs[0];
                    const isTimeSensitive = bestDoc.content.includes("ช่วงเปิดภาคเรียน") || bestDoc.content.includes("ช่วงปิดภาคเรียน");

                    if (isTimeSensitive) {
                        // --- 5A.1: Broad + Time-Sensitive (เช่น "ห้องสมุด")
                        console.log(`[RERANK V32] Broad, Time-Sensitive. Manually assembling all timeframes...`);

                        const openDocs = allRetrievedDocs.filter(doc => doc.content.includes("ช่วงเปิดภาคเรียน"));
                        const closedDocs = allRetrievedDocs.filter(doc => doc.content.includes("ช่วงปิดภาคเรียน"));

                        let combinedDocs = [];
                        if (openDocs.length > 0) combinedDocs.push(openDocs[0]);
                        if (closedDocs.length > 0) combinedDocs.push(closedDocs[0]);

                        if (combinedDocs.length > 0) {
                            retrievedDocs = combinedDocs;
                        } else {
                            retrievedDocs = allRetrievedDocs.slice(0, 2); // Fallback
                        }
                    } else {
                        // --- 5A.2: Broad + Evergreen (เช่น "กยศ")
                        console.log(`[RERANK V32] Broad, Evergreen. Skipping filters.`);
                        retrievedDocs = allRetrievedDocs.slice(0, 3); // ‼️ "ห้าม" กรอง
                    }

                } else {
                    // --- 5B. SPECIFIC QUERY (เจาะจง - ระบุวันที่) ---
                    // (เช่น "วันที่ 8 พ.ย. ห้องสมุดเปิดกี่โมง")
                    console.log(`[RERANK V32] Specific query detected. Filtering by ${timeframe} and ${day_type}.`);

                    let filteredDocs = allRetrievedDocs.filter(doc => doc.content.includes(timeframe));

                    if (day_type !== "ไม่ระบุ" && filteredDocs.length > 1) {
                        const dayTypeFilteredDocs = filteredDocs.filter(doc => doc.content.includes(day_type));
                        if (dayTypeFilteredDocs.length > 0) {
                            filteredDocs = dayTypeFilteredDocs;
                        }
                    }
                    retrievedDocs = filteredDocs.slice(0, 3);
                }
            } else {
                retrievedDocs = []; // ถ้าค้นหาไม่เจอเลย
            }
            // --- ‼️ NEW V32 LOGIC END ‼️ ---

            // 6. เรียกใช้ V21 Synthesizer (ตัวเดิม)
            botResponse = await callGroqLLM_RAG_V21_Synthesizer(
                userId,
                search_topic, // ‼️ ใช้ search_topic (V26)
                retrievedDocs,
                recentHistory
            );
        }

        // Final fallback
        if (!botResponse || botResponse.trim() === '') {
            console.log("⚠️ botResponse is still empty after ALL logic. Using generic fallback.");
            botResponse = "ขออภัยค่ะ ฉันไม่สามารถตอบคำถามนี้ได้ในขณะนี้ โปรดลองถามใหม่หรือติดต่อเจ้าหน้าที่ค่ะ";
        }

        // --- SAVE LOG ---
        console.log(`💾 Saving log for user: ${userId} in room: ${roomId}`);
        try {
            await firestore.collection('chat_logs').add({
                userId: userId,
                roomId: roomId, // <-- ‼️ เพิ่ม field นี้
                userMessage: message,
                botResponse: botResponse,
                intent: intent,
                website: websiteUrl,
                timestamp: new Date()
            });
            console.log("   ✅ Log saved successfully.");
        } catch (logError) {
            console.error("🔴 Error saving chat log:", logError);
        }

        // --- SEND RESPONSE ---
        const endTime = Date.now();
        console.log(`✅ Final Bot Response: "${botResponse.substring(0, 50)}..."`);
        console.log(`⏱️ Processing time: ${endTime - startTime}ms`);
        console.log('--- [HANDLER END V14] ---');
        res.json({ reply: botResponse, website: websiteUrl });

    } catch (error) {
        console.error('🔴 FATAL ERROR processing chat request:', error);
        console.log('--- [HANDLER ERROR END V14] ---');
        res.status(500).json({ error: 'เกิดข้อผิดพลาดร้ายแรง กรุณาลองใหม่ภายหลัง' });
    }
});


// --- 8. API ENDPOINT FOR FETCHING CHAT ROOMS (Sidebar) ---
// --- 8. API ENDPOINT FOR FETCHING CHAT ROOMS (Sidebar) ---
app.get('/api/chat/rooms/:userId', async (req, res) => {
    // --- ‼️‼️ V33.5 DEBUG LOG START ‼️‼️ ---
    const startTime = Date.now();
    console.log(`\n✅ [${new Date().toISOString()}] Received request on /api/chat/rooms/${req.params.userId}`);
    // --- ‼️‼️ V33.5 DEBUG LOG END ‼️‼️ ---
    console.log(`--- [ROOMS REQUEST V33.5] User: ${req.params.userId} ---`); // <-- V33.5 Log
    const { userId } = req.params;
    if (!userId) {
        console.error("🔴 [ROOMS V33.5] User ID is missing!");
        return res.status(400).json({ error: 'User ID is required' });
    }
    try {
        console.log("   [ROOMS V33.5] Querying Firestore for user logs...");
        const query = firestore.collection('chat_logs')
            .where('userId', '==', userId)
            .orderBy('timestamp', 'desc');

        const snapshot = await query.get();
        console.log(`   [ROOMS V33.5] Firestore query returned ${snapshot.size} documents.`);

        if (snapshot.empty) {
            console.log("   ✅ No logs found for this user. Returning empty list.");
            // --- ‼️‼️ V33.5 DEBUG LOG START ‼️‼️ ---
            console.log(`   [ROOMS V33.5] Sending empty response. Time taken: ${Date.now() - startTime}ms`);
            // --- ‼️‼️ V33.5 DEBUG LOG END ‼️‼️ ---
            return res.json([]);
        }

        const rooms = new Map();
        console.log("   [ROOMS V33.5] Processing documents to group by roomId...");
        snapshot.docs.forEach((doc, index) => {
            // --- ‼️‼️ V33.5 DEBUG LOG START ‼️‼️ ---
            // console.log(`   [ROOMS V33.5] Processing doc #${index + 1} (ID: ${doc.id})...`);
            // --- ‼️‼️ V33.5 DEBUG LOG END ‼️‼️ ---
            const data = doc.data();
            if (!data) {
                console.warn(`   [ROOMS V33.5] Skipping log ${doc.id} due to missing data.`);
                return;
            }
            const { roomId, userMessage, timestamp } = data;

            if (!roomId) {
                // --- ‼️‼️ V33.5 DEBUG LOG START ‼️‼️ ---
                // console.log(`   [ROOMS V33.5] Skipping log ${doc.id}: Missing roomId.`);
                // --- ‼️‼️ V33.5 DEBUG LOG END ‼️‼️ ---
                return;
            }

            let lastUpdatedDate;
            try {
                if (!timestamp || typeof timestamp.toDate !== 'function') {
                    throw new Error('Invalid or missing timestamp field');
                }
                lastUpdatedDate = timestamp.toDate();
                // --- ‼️‼️ V33.5 DEBUG LOG START ‼️‼️ ---
                // console.log(`   [ROOMS V33.5] Log ${doc.id}: Timestamp OK (${lastUpdatedDate.toISOString()}).`);
                // --- ‼️‼️ V33.5 DEBUG LOG END ‼️‼️ ---
            } catch (tsError) {
                console.warn(`   [ROOMS V33.5] Skipping log ${doc.id} due to invalid timestamp:`, tsError.message);
                return;
            }

            // --- ‼️‼️ V33.5 DEBUG LOG START ‼️‼️ ---
            // console.log(`   [ROOMS V33.5] Log ${doc.id}: RoomId='${roomId}', UserMessage='${userMessage ? userMessage.substring(0,10)+"..." : "N/A"}'.`);
            // --- ‼️‼️ V33.5 DEBUG LOG END ‼️‼️ ---

            if (!rooms.has(roomId)) {
                // --- ‼️‼️ V33.5 DEBUG LOG START ‼️‼️ ---
                // console.log(`   [ROOMS V33.5] Adding new room to map: ${roomId}`);
                // --- ‼️‼️ V33.5 DEBUG LOG END ‼️‼️ ---
                rooms.set(roomId, {
                    roomId: roomId,
                    title: userMessage ? userMessage.substring(0, 50) : 'Untitled Chat',
                    lastUpdated: lastUpdatedDate
                });
            } else {
                // --- ‼️‼️ V33.5 DEBUG LOG START ‼️‼️ ---
                // console.log(`   [ROOMS V33.5] Room ${roomId} already in map. Skipping.`);
                // --- ‼️‼️ V33.5 DEBUG LOG END ‼️‼️ ---
            }
        });

        const roomList = Array.from(rooms.values());
        console.log(`   [ROOMS V33.5] Grouping complete. Found ${roomList.length} unique rooms.`);

        console.log("   [ROOMS V33.5] Sorting rooms by lastUpdated...");
        roomList.sort((a, b) => b.lastUpdated - a.lastUpdated);

        // --- ‼️‼️ V33.5 DEBUG LOG START ‼️‼️ ---
        console.log(`   [ROOMS V33.5] Final room list to send:`, JSON.stringify(roomList, null, 2));
        console.log(`   [ROOMS V33.5] Sending response. Time taken: ${Date.now() - startTime}ms`);
        // --- ‼️‼️ V33.5 DEBUG LOG END ‼️‼️ ---
        res.json(roomList);

    } catch (error) {
        // เพิ่มการ Log Error ที่ละเอียดขึ้น
        console.error('🔴 ERROR FETCHING ROOMS (V33.5):', error.message, error.stack);
        // --- ‼️‼️ V33.5 DEBUG LOG START ‼️‼️ ---
        console.log(`   [ROOMS V33.5] Sending error response. Time taken: ${Date.now() - startTime}ms`);
        // --- ‼️‼️ V33.5 DEBUG LOG END ‼️‼️ ---
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในการดึงข้อมูลห้องแชท' });
    }
});

// --- 8.5 (NEW V33) API ENDPOINT FOR FETCHING MESSAGES IN A ROOM ---
app.get('/api/chat/room/:roomId', async (req, res) => {
    console.log(`\n--- [MESSAGES REQUEST V33.1] Room: ${req.params.roomId} ---`); // <-- V33.1 Log
    const { roomId } = req.params;
    if (!roomId) {
        return res.status(400).json({ error: 'Room ID is required' });
    }
    try {
        const query = firestore.collection('chat_logs')
            .where('roomId', '==', roomId)
            .orderBy('timestamp', 'asc');

        const snapshot = await query.get();
        if (snapshot.empty) {
            console.log("   ✅ No messages found for this room.");
            return res.json([]);
        }

        const messages = snapshot.docs.map(doc => {
            const data = doc.data();
            // --- ‼️‼️ V33.1 FIX START ‼️‼️ ---
            // (เผื่อกรณีข้อมูลผิดพลาด) ถ้าไม่มี roomId หรือ userMessage/botResponse ให้ข้าม
            if (!data.roomId || !data.userMessage || !data.botResponse) {
                console.warn(`   [MESSAGES V33.1] Skipping invalid log ${doc.id} in room ${roomId}.`);
                return null;
            }
            // --- ‼️‼️ V33.1 FIX END ‼️‼️ ---

            return [
                { text: data.userMessage, sender: 'user' },
                { text: data.botResponse, sender: 'bot', website: data.website || null }
            ];
        }).filter(pair => pair !== null).flat();

        console.log(`   ✅ Returning ${messages.length / 2} pairs of messages.`);
        res.json(messages);

    } catch (error) {
        console.error('🔴 ERROR FETCHING MESSAGES (V33.1):', error);
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในการดึงข้อมูลข้อความ' });
    }
});


// --- 9. START SERVER ---
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`\n🚀 Backend server vFINAL-RAG-V14-CALENDAR-AWARE is running beautifully on port ${PORT}`);
    console.log(`   Project ID: ${projectId}`);
    console.log(`   Key File: ${keyFilename}`);
});