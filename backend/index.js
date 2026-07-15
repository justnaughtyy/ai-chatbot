// --- 1. IMPORT LIBRARIES & SETUP ---
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Firestore, Timestamp } = require('@google-cloud/firestore');
const Groq = require('groq-sdk');
const { createClient } = require('@supabase/supabase-js');
const { HfInference } = require("@huggingface/inference");
// ‼️ V33.4 FIX: ลบ AbortController ที่ require เอง
// const AbortController = require('node-abort-controller').AbortController;

const app = express();
app.use(cors());
app.use(express.json());

// --- 2. CONNECTIONS ---
const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
const keyFilename = './unichatbot56-286fadf12cae.json';
if (!projectId || !keyFilename || !process.env.GROQ_API_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !process.env.HF_TOKEN) {
    console.error("🔴 FATAL ERROR: Env vars missing."); process.exit(1);
}
let firestore, groq, supabase, hf;
// ‼️ V33.9 FIX: เปลี่ยน Model เป็น e5-base
const embeddingModelName = 'intfloat/multilingual-e5-base';
const EXPECTED_DIMENSION = 768;
try {
    firestore = new Firestore({ projectId, keyFilename });
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    hf = new HfInference(process.env.HF_TOKEN);
    console.log(`✅ Initialized external services (HF Embeddings: ${embeddingModelName}).`);
} catch (initError) {
    console.error("🔴 FATAL ERROR initializing services:", initError);
    process.exit(1);
}


// --- 3. HELPER FUNCTION: Get Chat History (V33 - Room Aware) ---
// (Section นี้เหมือนเดิม V33 ไม่ต้องแก้)
async function getRecentChatHistory(roomId, limit = 3) {
    console.log(`[HISTORY V33] Fetching up to ${limit} pairs for room: ${roomId}`);
    if (!roomId) {
        console.log("[HISTORY V33] No roomId provided, returning empty history.");
        return [];
    }
    try {
        const query = firestore.collection('chat_logs')
            .where('roomId', '==', roomId)
            .orderBy('timestamp', 'desc') // ‼️ Index นี้ต้องมี
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
            if (data.botResponse) history.push({ role: 'assistant', content: data.botResponse.substring(0, 500) });
        });
        console.log(`[HISTORY V33] Found and formatted ${snapshot.size} pairs.`);
        return history;
    } catch (histError) {
        console.error("🔴 Error fetching chat history:", histError);
        return [];
    }
}

// --- 4. HELPER FUNCTION: Vector Search (V33.7 FIX) ---
// (Section นี้เหมือนเดิม V33.7 ไม่ต้องแก้)
async function searchVectorDatabase(query, matchCount = 3, threshold = 0.60) {
    console.log(`[VECTOR V13] HF Multi-Search (${embeddingModelName}) for: "${query}" (Count: ${matchCount}, Threshold: ${threshold})`);
    if (!hf || !supabase) {
        console.error("🔴 Vector Search Error: HF client or Supabase client not initialized.");
        return [];
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        console.warn(`⚠️ HF Embedding request timed out for query: "${query}"`);
        controller.abort();
    }, 60000); // ‼️ V33.8 FIX: 60 วินาที

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
            return data.map(item => ({ content: item.content, similarity: item.similarity, source: item.metadata?.source || 'เอกสารทั่วไป' }));
        } else { console.log('[VECTOR V13] No relevant docs found.'); return []; }
    } catch (e) {
        clearTimeout(timeoutId);
        // --- ‼️‼️ V33.7 DEBUG LOG START ‼️‼️ ---
        console.error("🔴 Error occurred during HF vector search:", e);
        // --- ‼️‼️ V33.7 DEBUG LOG END ‼️‼️ ---

        if (e.name === 'AbortError') {
            console.error("   (Error name suggests it was a timeout or abort signal)");
        } else {
            console.error("   (Error was not an AbortError)");
        }
        return [];
    }
}


// --- 5. HELPER FUNCTION: Get Calendar Data ---
// (Section นี้เหมือนเดิม ไม่ต้องแก้)
let calendarCache = null;
let calendarStringCache = null;
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

// --- 5.5 (NEW V29) HELPER FUNCTION: NLU Extraction ---
// (Section นี้เหมือนเดิม V29 ไม่ต้องแก้)
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
    const systemPrompt = `คุณคือผู้เชี่ยวชาญด้านการวิเคราะห์คำค้นหา (Search Query Expert)
หน้าที่ของคุณคือทำ 3 อย่างพร้อมกัน และตอบเป็น JSON Object เท่านั้น:
1.  **Rewrite Query (standalone_query):**
    * อ่าน "ประวัติการสนทนา" และ "คำถามล่าสุด"
    * "เขียนคำถามล่าสุดใหม่" ให้เป็นประโยคที่สมบูรณ์ เข้าใจได้ในตัวเอง (Standalone Question)
2.  **Extract Topic (search_topic):**
    * จาก "Standalone Question" ให้ "สรุปหัวข้อหลัก" ที่ใช้สำหรับค้นหา (ตัดวันที่และเวลาออก)
3.  * **(สำคัญ!): ถ้าคำถามไม่ระบุวันที่เลย** (เช่น "ขั้นตอนการยืนยันตัวตน" หรือ "ข้อมูล กยศ") ให้ตอบเป็น \`null\``;
    const userPrompt = `
## ข้อมูลประกอบการวิเคราะห์
- เวลาปัจจุบัน: ${currentTimeString}
- ปฏิทิน (YYYY-MM-DD): ${machineCalendarString}
- ประวัติการสนทนา:
${historyString}
## คำถามล่าสุด:
${userMessage}
## ผลการวิเคราะห์ (JSON เท่านั้น):`;
    const fallbackResult = {
        standalone_query: userMessage,
        search_topic: userMessage.replace(/วันที่|เดือน|พ.ศ.|[0-9/]/g, '').trim(),
        target_iso_date: null
    };
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        console.warn(`[V18-HELPER V29] Groq (70b) request timed out.`);
        controller.abort();
    }, 12000);
    try {
        const chatCompletion = await groq.chat.completions.create(
            {
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                model: 'llama-3.3-70b-versatile', // ‼️ V33.9 FIX: ใช้ 70b ที่ถูกต้อง
                temperature: 0.0,
                response_format: { type: "json_object" },
            },
            {
                signal: controller.signal
            }
        );
        clearTimeout(timeoutId);
        const jsonString = chatCompletion.choices[0]?.message?.content;
        if (jsonString) {
            try {
                const result = JSON.parse(jsonString);
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
        return fallbackResult;
    }
}


// --- 5.6 (NEW V25) HELPER FUNCTION: Deterministic Date Calculation ---
// (Section นี้เหมือนเดิม V25 ไม่ต้องแก้)
function calculateTimeInfo(target_iso_date, calendarData) {
    console.log(`[CALC V25] Calculating info for ISO Date: ${target_iso_date}`);
    try {
        const targetDate = new Date(target_iso_date + 'T00:00:00.000Z');
        let timeframe = "ช่วงปิดภาคเรียน"; // Default
        const sem1Start = calendarData.semester_1_start.toDate();
        const sem1End = calendarData.semester_1_end.toDate();
        const sem2Start = calendarData.semester_2_start.toDate();
        const sem2End = calendarData.semester_2_end.toDate();
        if ((targetDate >= sem1Start && targetDate <= sem1End) || (targetDate >= sem2Start && targetDate <= sem2End)) {
            timeframe = "ช่วงเปิดภาคเรียน";
        }
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
        return { timeframe: "ไม่ระบุช่วงเวลา", day_type: "ไม่ระบุ" };
    }
}


// --- 6. HELPER FUNCTION: Call Groq LLM (RAG V31 - Synthesizer) ---
// (Section นี้เหมือนเดิม V31 ไม่ต้องแก้)
async function callGroqLLM_RAG_V21_Synthesizer(userId, userMessage, retrievedDocs, recentHistory) {
    console.log(`🗣️ Calling Groq LLM (RAG V31 Synthesizer) with ${retrievedDocs.length} pre-filtered doc(s)...`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        console.warn(`⚠️ Groq LLM (V31) request timed out for user: ${userId}`);
        controller.abort();
    }, 30000);
    try {
        const systemPrompt = `คุณคือ AI ผู้ช่วยให้คำปรึกษาด้านกองทุนกู้ยืมเพื่อการศึกษา (กยศ.) 
หน้าที่ของคุณคือตอบ "คำถามล่าสุด" โดยการ **สังเคราะห์คำตอบจาก "เอกสารข้อมูล" ที่เตรียมมาให้เท่านั้น**

ขั้นตอนการทำงาน:
1. อ่าน "คำถามล่าสุด" (เช่น "ขั้นตอนการกู้ยืม", "กู้รายใหม่ใช้เอกสารอะไรบ้าง", "ผู้กู้รายเก่ากู้ยังไง", "ผู้กู้รายเก่าใช้เอกสารอะไรบ้าง")
2. อ่าน "เอกสารข้อมูล" ทุกชิ้น
3. สังเคราะห์คำตอบโดย "รวมข้อมูล" จาก "ทุก" เอกสารให้ครบถ้วนและเข้าใจง่าย
4. **(สำคัญมาก!) หากผู้ใช้ถามหาแหล่งที่มา ลิงก์ หรืออ้างอิง และในเอกสารมีลิงก์ (URL) หรือข้อความ "อ้างอิงจาก" ปรากฏอยู่ คุณต้องคัดลอกลิงก์นั้นส่งให้ผู้ใช้อย่างชัดเจน**

ข้อห้าม:
- ห้ามใช้คำพูดว่า "อ้างอิงจากเอกสารข้อมูลที่ 1" หรือ "ตามข้อมูลที่ค้นเจอ" (ให้ตอบเนื้อหาหรือให้ลิงก์ไปเลยอย่างเป็นธรรมชาติ)
- **ห้ามขึ้นต้นประโยคด้วยการขอโทษ (เช่น ขออภัยค่ะ, ขอโทษด้วย) หากคุณมีข้อมูลตอบคำถามได้ ให้ตอบคำถามด้วยความมั่นใจไปเลย**
- **ห้ามนำข้อมูลของกลุ่มผู้กู้ที่ต่างกัน (เช่น 'รายใหม่', 'รายเก่า', 'ภาคปกติ', 'ภาคพิเศษ') มาผสมกันเด็ดขาด! ให้ตอบเฉพาะเงื่อนไข วันที่ และสถานที่ ที่ระบุตรงกับกลุ่มเป้าหมายในคำถามเท่านั้น**
- หากในเอกสารมีข้อมูลหลายกลุ่ม ให้คัดกรองมาเฉพาะกลุ่มที่ผู้ใช้ถามถึง ห้ามสรุปรวมกัน
- ถ้าไม่เจอเอกสาร ให้ตอบว่า "ขออภัยค่ะ ฉันไม่มีข้อมูลในส่วนนี้"
- ตอบเป็นภาษาไทย กระชับ ชัดเจน อัธยาศัยดี`;
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
            model: 'llama-3.1-8b-instant',
            temperature: 0.1,
            max_tokens: 1024
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
// ‼️‼️‼️‼️ V34 CHANGE ‼️‼️‼️‼️
app.post('/api/chat', async (req, res) => {
    console.log(`\n✅ [${new Date().toISOString()}] Received request on POST /api/chat`);
    console.log('--- [HANDLER START V34] ---');
    const startTime = Date.now();

    // 1. รับ roomId
    const { message, userId, roomId } = req.body;
    if (!message || !userId || !roomId) {
        console.log("🔴 Request validation failed: Missing message, userId, or roomId.");
        return res.status(400).json({ error: 'Message, User ID, and Room ID are required' });
    }
    console.log(`[USER: ${userId}] [ROOM: ${roomId}] Message: "${message}"`);

    // (ดึงข้อมูลเวลาและปฏิทิน - เหมือนเดิม)
    const now = new Date();
    const currentTimeString = now.toLocaleString('th-TH', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok'
    });
    const { calendarData, calendarString } = await getCalendarInfo(now);
    console.log(`[TIME] Current time: ${currentTimeString}`);
    console.log(`[CALENDAR] Calendar info loaded.`);

    let sessionClient;
    try {
        const dialogflow = require('@google-cloud/dialogflow');
        sessionClient = new dialogflow.SessionsClient({ projectId, keyFilename });
    } catch (dfError) {
        console.error("🔴 FATAL ERROR: Failed to create Dialogflow client:", dfError);
        return res.status(500).json({ error: 'Internal server error initializing Dialogflow' });
    }

    try {
        const sessionIdForDialogflow = userId; // (ใช้ userId เป็น session ได้)
        const sessionPath = sessionClient.projectAgentSessionPath(projectId, sessionIdForDialogflow);
        const request = {
            session: sessionPath,
            queryInput: { text: { text: message, languageCode: 'th-TH' } },
        };
        console.log("📡 Sending request to Dialogflow (V34)...");
        const responses = await sessionClient.detectIntent(request);
        const result = responses[0].queryResult;
        console.log("✅ Received response from Dialogflow (V34).");

        const intent = result.intent ? result.intent.displayName : 'Default Fallback Intent';
        console.log(`🧠 Detected Intent: ${intent} (via Dialogflow)`);

        let botResponse = null;
        let websiteUrl = null;

        const simpleIntents = ['Default Welcome Intent', 'Smalltalk - User - Thanks'];

        if (simpleIntents.includes(intent)) {
            // (Handle simple intents - เหมือนเดิม)
            // ... (โค้ดส่วนนี้เหมือนเดิม) ...
        }

        // --- RAG V32 LOGIC (เหมือนเดิม) ---
        if (botResponse === null) {
            console.log(`⏳ Intent "${intent}" requires RAG V32. Starting process...`);

            // 1. ดึงประวัติแชท (V33)
            const recentHistory = await getRecentChatHistory(roomId);

            // 2. เรียก V29 Helper (70b) - (NLU)
            const { standalone_query, search_topic, target_iso_date } = await getSearchContext(
                message,
                recentHistory,
                currentTimeString,
                calendarData
            );

            // 3. และ 4. ค้นหา Vector Database ด้วย "Search Topic"
            console.log(`[QUERY] Using Topic Search: "${search_topic}"`);
            
            // ดึงข้อมูลมาแค่ 3 ชิ้นที่คะแนนความเหมือน (Similarity) สูงที่สุดก็พอ 
            // ไม่ต้องเผื่อไว้ 10 ชิ้นแล้วเพราะเราไม่ได้เอามาฟิลเตอร์เปิด/ปิดเทอมต่อแล้ว
            let retrievedDocs = await searchVectorDatabase(search_topic, 3, 0.70);

            // 6. เรียกใช้ V31 Synthesizer
            botResponse = await callGroqLLM_RAG_V21_Synthesizer(
                userId,
                search_topic, // ‼️ V26 FIX
                retrievedDocs,
                recentHistory
            );
        }

        // --- ‼️‼️‼️ V34 CHANGE ‼️‼️‼️ ---
        // (ย้าย Save Log มาไว้ก่อน Send Response)

        // 2. ตรวจสอบและสร้าง/อัปเดต Room Metadata
        const roomRef = firestore.collection('chat_rooms').doc(roomId);
        const roomDoc = await roomRef.get();
        const nowTimestamp = new Date();

        if (!roomDoc.exists) {
            // 2A. สร้างห้องใหม่ (ถ้าเป็นข้อความแรก)
            console.log(`[V34] Room ${roomId} not found. Creating new room...`);
            await roomRef.set({
                userId: userId,
                title: message.substring(0, 50), // ‼️ ใช้ข้อความแรกเป็นชื่อ
                createdAt: nowTimestamp,
                lastUpdated: nowTimestamp
            });
        } else {
            // 2B. อัปเดตเวลาล่าสุด (ถ้าห้องมีอยู่แล้ว)
            console.log(`[V34] Room ${roomId} found. Updating lastUpdated...`);
            await roomRef.update({
                lastUpdated: nowTimestamp
            });
        }

        // 3. บันทึก Log (เหมือนเดิม แต่ย้ายที่)
        console.log(`💾 Saving log for user: ${userId} in room: ${roomId}`);
        try {
            await firestore.collection('chat_logs').add({
                userId: userId,
                roomId: roomId,
                userMessage: message,
                botResponse: botResponse,
                intent: intent,
                website: websiteUrl,
                timestamp: nowTimestamp // ‼️ ใช้อันเดียวกับ lastUpdated
            });
            console.log("   ✅ Log saved successfully.");
        } catch (logError) {
            console.error("🔴 Error saving chat log:", logError);
        }

        // --- SEND RESPONSE ---
        const endTime = Date.now();
        console.log(`✅ Final Bot Response: "${botResponse.substring(0, 50)}..."`);
        console.log(`⏱️ Processing time: ${endTime - startTime}ms`);
        console.log('--- [HANDLER END V34] ---');
        res.json({ reply: botResponse, website: websiteUrl });

    } catch (error) {
        console.error('🔴 FATAL ERROR processing chat request:', error);
        console.log('--- [HANDLER ERROR END V34] ---');
        res.status(500).json({ error: 'เกิดข้อผิดพลาดร้ายแรง กรุณาลองใหม่ภายหลัง' });
    }
});


// --- 8. API ENDPOINT FOR FETCHING CHAT ROOMS (Sidebar) ---
// ‼️‼️‼️‼️ V34 CHANGE ‼️‼️‼️‼️
app.get('/api/chat/rooms/:userId', async (req, res) => {
    const startTime = Date.now();
    console.log(`\n✅ [${new Date().toISOString()}] Received request on /api/chat/rooms/${req.params.userId}`);
    console.log(`--- [ROOMS REQUEST V34] User: ${req.params.userId} ---`);
    const { userId } = req.params;
    if (!userId) {
        console.error("🔴 [ROOMS V34] User ID is missing!");
        return res.status(400).json({ error: 'User ID is required' });
    }
    try {
        // 1. Query "chat_rooms" collection (ไม่ใช่ "chat_logs")
        console.log("   [ROOMS V34] Querying 'chat_rooms' collection for user...");
        const query = firestore.collection('chat_rooms')
            .where('userId', '==', userId)
            .orderBy('lastUpdated', 'desc'); // ‼️ เรียงตาม lastUpdated

        const snapshot = await query.get();
        console.log(`   [ROOMS V34] Firestore query returned ${snapshot.size} documents.`);

        if (snapshot.empty) {
            console.log("   ✅ No rooms found for this user. Returning empty list.");
            console.log(`   [ROOMS V34] Sending empty response. Time taken: ${Date.now() - startTime}ms`);
            return res.json([]);
        }

        // 2. Map ข้อมูล (ง่ายกว่า V33 มาก)
        const roomList = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                roomId: doc.id, // ID ของ doc คือ roomId
                title: data.title,
                lastUpdated: data.lastUpdated.toDate()
            };
        });

        console.log(`   [ROOMS V34] Final room list to send:`, JSON.stringify(roomList, null, 2));
        console.log(`   [ROOMS V34] Sending response. Time taken: ${Date.now() - startTime}ms`);
        res.json(roomList);

    } catch (error) {
        console.error('🔴 ERROR FETCHING ROOMS (V34):', error.message, error.stack);
        console.log(`   [ROOMS V34] Sending error response. Time taken: ${Date.now() - startTime}ms`);
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในการดึงข้อมูลห้องแชท' });
    }
});


// --- 8.5 (NEW V33) API ENDPOINT FOR FETCHING MESSAGES IN A ROOM ---
// (Section นี้เหมือนเดิม V33.1 ไม่ต้องแก้)
app.get('/api/chat/room/:roomId', async (req, res) => {
    // --- ‼️‼️ DEBUG LOG START ‼️‼️ ---
    console.log(`\n✅ [${new Date().toISOString()}] Received request on /api/chat/room/${req.params.roomId}`);
    // --- ‼️‼️ DEBUG LOG END ‼️‼️ ---
    console.log(`--- [MESSAGES REQUEST V33.1] Room: ${req.params.roomId} ---`);
    const { roomId } = req.params;
    if (!roomId) {
        console.error("🔴 [MESSAGES V33.1] Room ID is missing!");
        return res.status(400).json({ error: 'Room ID is required' });
    }
    try {
        console.log("   [MESSAGES V33.1] Querying 'chat_logs' for room...");
        const query = firestore.collection('chat_logs')
            .where('roomId', '==', roomId)
            .orderBy('timestamp', 'asc'); // ‼️ Index นี้ต้องมี

        const snapshot = await query.get();
        console.log(`   [MESSAGES V33.1] Firestore query returned ${snapshot.size} documents.`);
        if (snapshot.empty) {
            console.log("   ✅ No messages found.");
            console.log(`   [MESSAGES V33.1] Sending empty response.`);
            return res.json([]);
        }

        const messages = snapshot.docs.map(doc => {
            const data = doc.data();
            // V33.1 FIX
            if (!data || !data.userMessage || !data.botResponse) {
                console.warn(`   [MESSAGES V33.1] Skipping invalid log ${doc.id}`);
                return null;
            }
            return [
                { text: data.userMessage, sender: 'user' },
                { text: data.botResponse, sender: 'bot', website: data.website || null }
            ];
        }).filter(pair => pair !== null).flat();

        console.log(`   ✅ Returning ${messages.length / 2} pairs of messages.`);
        console.log(`   [MESSAGES V33.1] Sending response.`);
        res.json(messages);

    } catch (error) {
        console.error('🔴 ERROR FETCHING MESSAGES (V33.1):', error.message, error.stack);
        console.log(`   [MESSAGES V33.1] Sending error response.`);
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในการดึงข้อมูลข้อความ' });
    }
});


// --- 9. (NEW V34) API ENDPOINT FOR RENAMING A ROOM ---
app.put('/api/chat/room/:roomId', async (req, res) => {
    console.log(`\n✅ [${new Date().toISOString()}] Received request on PUT /api/chat/room/${req.params.roomId}`);
    const { roomId } = req.params;
    const { title } = req.body; // รับ title ใหม่จาก body

    if (!roomId || !title) {
        return res.status(400).json({ error: 'Room ID and new title are required' });
    }

    try {
        const roomRef = firestore.collection('chat_rooms').doc(roomId);

        await roomRef.update({
            title: title,
            lastUpdated: new Date() // อัปเดตเวลาด้วย
        });

        console.log(`   [RENAME V34] Successfully renamed room ${roomId} to "${title}"`);
        res.status(200).json({ success: true, newTitle: title });

    } catch (error) {
        console.error(`🔴 ERROR RENAMING ROOM ${roomId}:`, error);
        res.status(500).json({ error: 'Failed to rename room' });
    }
});


// --- 10. (NEW V34) API ENDPOINT FOR DELETING A ROOM ---
app.delete('/api/chat/room/:roomId', async (req, res) => {
    console.log(`\n✅ [${new Date().toISOString()}] Received request on DELETE /api/chat/room/${req.params.roomId}`);
    const { roomId } = req.params;

    if (!roomId) {
        return res.status(400).json({ error: 'Room ID is required' });
    }

    try {
        console.log(`   [DELETE V34] Starting delete process for room: ${roomId}`);
        const batch = firestore.batch();

        // 1. ลบเอกสาร Metadata
        const roomRef = firestore.collection('chat_rooms').doc(roomId);
        batch.delete(roomRef);
        console.log(`   [DELETE V34] Added room metadata to batch.`);

        // 2. ค้นหาและลบเอกสาร Logs ทั้งหมดที่เกี่ยวข้อง
        const logsQuery = firestore.collection('chat_logs').where('roomId', '==', roomId);
        const logsSnapshot = await logsQuery.get();

        if (logsSnapshot.empty) {
            console.log(`   [DELETE V34] No matching chat logs found.`);
        } else {
            console.log(`   [DELETE V34] Found ${logsSnapshot.size} chat logs to delete. Adding to batch...`);
            logsSnapshot.docs.forEach(doc => {
                batch.delete(doc.ref);
            });
        }

        // 3. Commit การลบทั้งหมด
        await batch.commit();
        console.log(`   [DELETE V34] Successfully deleted room ${roomId} and all associated logs.`);
        res.status(200).json({ success: true });

    } catch (error) {
        console.error(`🔴 ERROR DELETING ROOM ${roomId}:`, error);
        res.status(500).json({ error: 'Failed to delete room and its messages' });
    }
});


// --- 11. START SERVER ---
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`\n🚀 Backend server vV34 (Room Metadata) is running beautifully on port ${PORT}`);
    console.log(`   Project ID: ${projectId}`);
    console.log(`   Key File: ${keyFilename}`);
});