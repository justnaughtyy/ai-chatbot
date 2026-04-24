require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function runTest() {
  console.log("--- Starting Gemini Definitive Test ---");

  // 1. ตรวจสอบว่า Key ถูกโหลดหรือไม่
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("🔴 FATAL ERROR: ไม่พบ GEMINI_API_KEY ในไฟล์ .env");
    return;
  }
  console.log(`✅ API Key Loaded Successfully.`);

  try {
    // 2. พยายามเชื่อมต่อและเรียกใช้ Gemini
    const genAI = new GoogleGenerativeAI(apiKey);
    // const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });

    console.log("🚀 Sending a simple request to Gemini...");
    const prompt = "Please introduce yourself in one short sentence in Thai.";

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // 3. แสดงผลลัพธ์ถ้าสำเร็จ
    console.log("\n\n✨🎉 SUCCESS! Gemini is working! 🎉✨");
    console.log("Gemini's Response:", text);

  } catch (error) {
    // 4. แสดงผลลัพธ์ถ้าล้มเหลว
    console.error("\n\n🔴 TEST FAILED: Could not get a response from Gemini. 🔴");
    console.error("Below is the detailed error from Google:");
    console.error(error);
  }
  console.log("\n--- Test Finished ---");
}

runTest();