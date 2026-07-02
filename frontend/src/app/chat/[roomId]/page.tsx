'use client'

import { useState, useRef, useEffect } from 'react'
// ‼️ V33 CHANGE: import 'useParams' (สำหรับอ่าน ID ห้อง) และลบ 'useRouter' (เพราะ layout จัดการ)
import { useParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
// ‼️ V33 CHANGE: ลบ 'auth' และ 'signOut' (ย้ายไป UserNav.tsx)
import { SendHorizonal, Bot, User } from 'lucide-react' // ‼️ V33 CHANGE: ลบ LogOut
import { Button } from '@/components/ui/button'

interface Message {
  text: string
  sender: 'user' | 'bot'
  website?: string | null
}

// ‼️ V33 CHANGE: ลบ SESSION_ID_KEY
// const SESSION_ID_KEY = 'university-chatbot-session-id';

export default function ChatRoomPage() { // ‼️ V33 CHANGE: เปลี่ยนชื่อ Component
  // --- STEP 1: CALL ALL HOOKS UNCONDITIONALLY AT THE TOP ---
  const { user, loading } = useAuth()
  // ‼️ V33 CHANGE: ลบ router
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  // ‼️ V33 CHANGE: ลบ sessionId
  const messagesEndRef = useRef<null | HTMLDivElement>(null)

  // ‼️ V33 CHANGE: อ่าน roomId จาก URL
  const params = useParams()
  const roomId = params.roomId as string // (เช่น '123-abc-xyz')

  // --- STEP 2: HANDLE LOGIC WITH useEffect ---

  // ‼️ V33 CHANGE: ลบ Guard Effect (ย้ายไป (chat)/layout.tsx)

  // History Loading Effect (V33)
  useEffect(() => {
    // ‼️ V33 CHANGE: เพิ่ม roomId เข้าไปในเงื่อนไข
    console.log(
      `[FRONTEND-CCTV-V33] History effect running. Loading: ${loading}, User: ${!!user}, RoomID: ${!!roomId}`
    )
    if (!loading && user && roomId) {
      console.log(
        `[FRONTEND-CCTV-V33-1] Conditions met. Fetching history for ROOM: ${roomId}`
      )
      setIsLoading(true) // เริ่ม loading

      // ‼️ V33 CHANGE: เรียก Endpoint ใหม่
      fetch(`https://ai-chatbot-slf.onrender.com/api/chat/room/${roomId}`) // (ใช้ http://localhost:3001 ถ้า dev)
        .then((res) => res.json())
        .then((history: Message[]) => {
          console.log(
            '[FRONTEND-CCTV-V33-2] Received history from backend:',
            history
          )
          if (history && history.length > 0) {
            console.log(
              '[FRONTEND-CCTV-V33-3] Setting messages with history.'
            )
            setMessages(history)
          } else {
            console.log(
              '[FRONTEND-CCTV-V33-3] No history found, setting welcome message.'
            )
            setMessages([
              { text: 'สวัสดีค่ะ เริ่มบทสนทนาได้เลยค่ะ', sender: 'bot' },
            ])
          }
        })
        .catch((err) => {
          console.error('Failed to fetch history:', err)
          setMessages([
            { text: 'ไม่สามารถโหลดประวัติการแชทได้', sender: 'bot' },
          ])
        })
        .finally(() => {
          console.log(
            '[FRONTEND-CCTV-V33-4] Finished fetching, setting isLoading to false.'
          )
          setIsLoading(false) // หยุด loading
        })
    } else {
      setIsLoading(loading)
    }
  }, [user, loading, roomId]) // ‼️ V33 CHANGE: เพิ่ม roomId ใน dependencies

  // Scroll to bottom effect
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const handleSend = async () => {
    // ‼️ V33 CHANGE: เพิ่ม roomId ใน guard
    if (input.trim() === '' || isLoading || !user || !roomId) return

    const userMessage: Message = { text: input, sender: 'user' }
    setMessages((prev) => [...prev, userMessage])
    const currentInput = input
    setInput('')
    setIsLoading(true)

    try {
      // ‼️ V33 CHANGE: ส่ง roomId ไปใน body
      const response = await fetch('https://ai-chatbot-slf.onrender.com/api/chat', { // (ใช้ http://localhost:3001 ถ้า dev)
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: currentInput,
          userId: user.uid,
          roomId: roomId, // ‼️ V33 CHANGE: เพิ่ม field นี้
        }),
      })

      if (!response.ok) throw new Error('Network response was not ok')
      const data = await response.json()

      const botMessage: Message = {
        text: data.reply,
        sender: 'bot',
        website: data.website,
      }
      setMessages((prev) => [...prev, botMessage])
    } catch (error) {
      console.error('Failed to fetch chat response:', error)
      const errorMessage: Message = {
        text: 'ขออภัยค่ะ ระบบขัดข้อง โปรดลองอีกครั้ง',
        sender: 'bot',
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  // ‼️ V33 CHANGE: ลบ handleLogout (ย้ายไป UserNav.tsx)

  // ‼️ V33 CHANGE: ลบ if (loading || !user) (ย้ายไป (chat)/layout.tsx)

  // Render the chat UI
  // ‼️ V33 CHANGE: เปลี่ยน h-screen เป็น h-full และลบ <header>
  return (
    <div className="flex flex-col h-full bg-background font-sans">
      {/* ‼️ V33 CHANGE: <header> ถูกลบออกไป (มันอยู่ใน layout.tsx) */}

      <main className="flex-1 overflow-y-auto p-4">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.map((msg, index) => (
            <div
              key={index}
              className={`flex items-end gap-3 ${
                msg.sender === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {/* ‼️ V33 CHANGE: อัปเดตสีให้เข้ากับ shadcn/ui (เป็นทางเลือก) */}
              {msg.sender === 'bot' && (
                <div className="w-9 h-9 bg-primary rounded-full flex items-center justify-center text-primary-foreground flex-shrink-0">
                  <Bot size={22} />
                </div>
              )}
              <div
                className={`max-w-md lg:max-w-lg px-4 py-3 rounded-2xl ${
                  msg.sender === 'user'
                    ? 'bg-primary text-primary-foreground rounded-br-none'
                    // ‼️ V33 CHANGE: อัปเดตสี
                    : 'bg-muted text-muted-foreground rounded-bl-none'
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.text}</p>
                {/* ‼️ V33 CHANGE: อัปเดตสี */}
                {msg.sender === 'bot' && msg.website && (
                  <a
                    href={msg.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-block bg-primary/10 text-primary font-semibold px-4 py-1.5 rounded-lg text-sm hover:bg-primary/20 transition-colors"
                  >
                    เข้าชมเว็บไซต์
                  </a>
                )}
              </div>
              {msg.sender === 'user' && (
                <div className="w-9 h-9 bg-secondary rounded-full flex items-center justify-center text-secondary-foreground flex-shrink-0">
                  <User size={22} />
                </div>
              )}
            </div>
          ))}
          {isLoading && (
            <div className="flex items-end gap-3 justify-start">
              <div className="w-9 h-9 bg-primary rounded-full flex items-center justify-center text-primary-foreground flex-shrink-0">
                <Bot size={22} />
              </div>
              {/* ‼️ V33 CHANGE: อัปเดตสี */}
              <div className="px-4 py-3 rounded-2xl bg-muted text-muted-foreground rounded-bl-none">
                <div className="flex items-center justify-center gap-1.5">
                  <span className="h-2 w-2 bg-muted-foreground/30 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                  <span className="h-2 w-2 bg-muted-foreground/30 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                  <span className="h-2 w-2 bg-muted-foreground/30 rounded-full animate-bounce"></span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* ‼️ V33 CHANGE: อัปเดตสี */}
      <footer className="bg-background border-t">
        <div className="max-w-4xl mx-auto p-4">
          <div className="flex items-center bg-muted rounded-xl p-1">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSend()}
              placeholder="พิมพ์ข้อความ..."
              className="flex-1 p-3 bg-transparent focus:outline-none"
              disabled={isLoading}
            />
            <Button
              onClick={handleSend}
              disabled={isLoading}
              className="p-3" // ‼️ V33 CHANGE: ใช้ <Button> จาก shadcn
            >
              <SendHorizonal size={20} />
            </Button>
          </div>
        </div>
      </footer>
    </div>
  )
}