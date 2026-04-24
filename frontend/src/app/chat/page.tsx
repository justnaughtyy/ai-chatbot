'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

interface Room {
  roomId: string
  // (fields อื่นๆ ไม่จำเป็นสำหรับหน้านี้)
}

// หน้านี้ทำหน้าที่ Redirect เท่านั้น
export default function ChatRootPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [isRedirecting, setIsRedirecting] = useState(true)

  useEffect(() => {
    // รอให้ user โหลดเสร็จก่อน
    if (!loading && user) {
      // ลองดึงรายการห้องแชท
      fetch(`/api/chat/rooms/${user.uid}`)
        .then((res) => res.json())
        .then((rooms: Room[]) => {
          if (rooms && rooms.length > 0) {
            // ถ้ามีห้องอยู่แล้ว -> ไปที่ห้องแรก (ห้องล่าสุด)
            console.log(
              `[ChatRootPage] Found ${rooms.length} rooms. Redirecting to the first one: ${rooms[0].roomId}`
            )
            router.replace(`/chat/${rooms[0].roomId}`) // ใช้ replace เพื่อไม่ให้ back กลับมาหน้านี้ได้
          } else {
            // ถ้าไม่มีห้องเลย -> สร้างห้องใหม่
            const newRoomId = uuidv4()
            console.log(
              `[ChatRootPage] No rooms found. Creating and redirecting to new room: ${newRoomId}`
            )
            router.replace(`/chat/${newRoomId}`)
          }
        })
        .catch((err) => {
          // ถ้า fetch ล้มเหลว (อาจจะ backend มีปัญหา) ให้สร้างห้องใหม่ไปก่อน
          console.error('[ChatRootPage] Failed to fetch rooms, creating new one:', err)
          const newRoomId = uuidv4()
          router.replace(`/chat/${newRoomId}`)
        })
        // (ไม่ต้อง setIsRedirecting(false) เพราะเราจะไปหน้าอื่นแล้ว)
    } else if (!loading && !user) {
      // ถ้าไม่ได้ login ก็ส่งไปหน้า login (เผื่อ Guard ใน layout ไม่ทำงาน)
       console.log('[ChatRootPage] User not logged in. Redirecting to /login')
       router.replace('/login')
    }
  }, [user, loading, router])

  // แสดง Loading... ระหว่างรอ redirect
  return (
    <div className="flex items-center justify-center h-full">
      <p>Loading your chat...</p>
    </div>
  )
}