'use client'

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { Sidebar } from './_components/Sidebar'
import { UserNav } from './_components/UserNav'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader, // ‼️ V36.1 Import (เพิ่ม)
  SheetTitle, // ‼️ V36.1 Import (เพิ่ม)
  SheetDescription, // ‼️ V36.1 Import (เพิ่ม)
  SheetTrigger,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { PanelLeft } from 'lucide-react'

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, loading } = useAuth()
  const router = useRouter()
  // ‼️ V36 State: State สำหรับควบคุมการเปิด/ปิด Sheet (เมนูมือถือ)
  const [isSheetOpen, setIsSheetOpen] = useState(false)

  // (Guard Effect เดิมของคุณ - ดีอยู่แล้ว)
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">Loading...</div>
    )
  }
  if (!user) {
    router.push('/login')
    return null
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="bg-background border-b z-10">
        <div className="h-16 flex items-center justify-between px-4">
          <div className="flex items-center gap-2">
            {/* --- ‼️ V36 ปุ่ม Hamburger (แสดงเฉพาะจอมือถือ) --- */}
            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
              <SheetTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="md:hidden" // ‼️ ซ่อนบน Desktop
                >
                  <PanelLeft />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="p-0 sm:max-w-xs" // ‼️ Drawer ที่สไลด์ออกมา
              >
                {/* --- ‼️ V36.1 ACCESSIBILITY FIX START ‼️ --- */}
                {/* (นี่คือโค้ดที่เพิ่มเข้ามาเพื่อแก้ Error) */}
                <SheetHeader>
                  <SheetTitle className="sr-only">Chat Sidebar</SheetTitle>
                  <SheetDescription className="sr-only">
                    A list of your recent chat sessions.
                  </SheetDescription>
                </SheetHeader>
                {/* --- ‼️ V36.1 ACCESSIBILITY FIX END ‼️ --- */}

                {/* ‼️ ใช้ Sidebar V36 ที่รับ onLinkClick */}
                <Sidebar onLinkClick={() => setIsSheetOpen(false)} />
              </SheetContent>
            </Sheet>
            {/* --- จบส่วน Hamburger --- */}

            <h1 className="text-xl font-bold">SLF AI Chatbot</h1>
          </div>
          <UserNav /> {/* (คอมโพเนนต์โปรไฟล์) */}
        </div>
      </header>

      {/* Main Content (Sidebar + Chat) */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Sidebar Panel (แสดงเฉพาะ Desktop) */}
        <ResizablePanel
          defaultSize={20}
          minSize={15}
          maxSize={25}
          className="hidden md:block" // ‼️ ซ่อนบนมือถือ
        >
          {/* ‼️ ใช้ Sidebar V36 (แต่ไม่ส่ง onLinkClick) */}
          <Sidebar />
        </ResizablePanel>

        <ResizableHandle withHandle className="hidden md:flex" />

        {/* Chat Panel */}
        <ResizablePanel defaultSize={80}>
          {children} {/* (นี่คือ [roomId]/page.tsx) */}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}