// app/(settings)/layout.tsx
'use client'

import { Separator } from '@/components/ui/separator'
import { SettingsSidebarNav } from './_components/SettingsSidebarNav' // (เดี๋ยวเราจะสร้างไฟล์นี้)
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { UserNav } from '../chat/_components/UserNav' // (ใช้ UserNav ตัวเดิม)
import Link from 'next/link'

// (เมนูสำหรับ Sidebar)
const sidebarNavItems = [
  {
    title: 'Profile',
    href: '/settings/profile',
  },
  {
    title: 'Password',
    href: '/settings/password',
  },
]

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, loading } = useAuth()
  const router = useRouter()

  // (Guard Effect กันคนไม่ได้ login)
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
      {/* Header (ใช้ Header คล้ายๆ เดิม) */}
      <header className="bg-background border-b z-10">
        <div className="h-16 flex items-center justify-between px-4">
          <Link href="/chat"><h1 className="text-xl font-bold">University AI Chatbot</h1></Link>
          <UserNav />
        </div>
      </header>

      {/* Main Content (Sidebar + Form) */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
            <p className="text-muted-foreground">
              Manage your account settings.
            </p>
          </div>
          <Separator />
          <div className="flex flex-col space-y-8 lg:flex-row lg:space-x-12 lg:space-y-0">
            {/* 1. Sidebar (ซ้าย) */}
            <aside className="-mx-4 lg:w-1/5">
              <SettingsSidebarNav items={sidebarNavItems} />
            </aside>
            {/* 2. Content (ขวา) */}
            <div className="flex-1">{children}</div>
          </div>
        </div>
      </main>
    </div>
  )
}