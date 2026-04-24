'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '../lib/firebase'; // Import จากไฟล์ที่เราสร้างไว้

// กำหนดหน้าตาของข้อมูลที่จะเก็บใน Context
interface AuthContextType {
  user: User | null; // ข้อมูลผู้ใช้จาก Firebase หรือเป็น null ถ้ายังไม่ login
  loading: boolean; // สถานะว่ากำลังโหลดข้อมูลผู้ใช้อยู่หรือไม่
}

// สร้าง Context ขึ้นมา
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// สร้าง "Provider" ซึ่งเป็นตัวจัดการข้อมูลทั้งหมด
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // นี่คือ "ผู้ฟัง" วิเศษจาก Firebase
    // มันจะทำงานอัตโนมัติทุกครั้งที่มีการ Login, Logout, หรือเปิดหน้าเว็บ
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user); // อัปเดตข้อมูลผู้ใช้
      setLoading(false); // บอกว่าโหลดเสร็จแล้ว
    });

    // คืนค่าฟังก์ชัน unsubscribe เพื่อทำความสะอาดเมื่อ component ถูกปิด
    return () => unsubscribe();
  }, []); // [] หมายถึงให้ทำแค่ครั้งเดียวตอนเริ่มต้น

  const value = { user, loading };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// สร้าง Hook ง่ายๆ เพื่อให้ component อื่นๆ เรียกใช้ข้อมูลได้สะดวก
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}