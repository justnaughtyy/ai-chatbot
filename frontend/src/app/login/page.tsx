'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase'; // Import จาก lib ที่เราสร้างไว้

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoginView, setIsLoginView] = useState(true); // true = หน้า Login, false = หน้า Sign Up
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); // ล้าง error เก่าทิ้ง

    try {
      if (isLoginView) {
        // --- โหมด Login ---
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        // --- โหมด Sign Up ---
        await createUserWithEmailAndPassword(auth, email, password);
      }
      // ถ้าสำเร็จ ให้เด้งไปหน้าแชท
      router.push('/chat');
    } catch (err: any) {
      // แสดงข้อความ Error ที่เข้าใจง่าย
      if (err.code === 'auth/email-already-in-use') {
        setError('อีเมลนี้ถูกใช้งานแล้ว');
      } else if (err.code === 'auth/invalid-credential') {
        setError('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
      } else if (err.code === 'auth/weak-password') {
        setError('รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร');
      } else if (err.code === 'auth/invalid-email') {
        setError('รูปแบบอีเมลไม่ถูกต้อง');
      } else {
        setError('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
      }
      console.error(err);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-lg shadow-md">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-800">
            {isLoginView ? 'Login' : 'Sign Up'}
          </h1>
          <p className="mt-2 text-gray-500">
            เข้าสู่ระบบ University AI Chatbot
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="อีเมลมหาวิทยาลัย"
            required
            className="w-full px-4 py-2 text-gray-700 bg-gray-100 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="รหัสผ่าน"
            required
            className="w-full px-4 py-2 text-gray-700 bg-gray-100 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {error && <p className="text-sm text-center text-red-500">{error}</p>}

          <button
            type="submit"
            className="w-full px-4 py-2 font-semibold text-white bg-blue-500 rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            {isLoginView ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}
          </button>
        </form>

        <p className="text-sm text-center text-gray-600">
          {isLoginView ? "ยังไม่มีบัญชี?" : "มีบัญชีอยู่แล้ว?"}
          <button
            onClick={() => setIsLoginView(!isLoginView)}
            className="ml-1 font-semibold text-blue-500 hover:underline"
          >
            {isLoginView ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'}
          </button>
        </p>
      </div>
    </div>
  );
}