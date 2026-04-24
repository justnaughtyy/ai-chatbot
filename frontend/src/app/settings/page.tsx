// app/(settings)/page.tsx
import { redirect } from 'next/navigation'

// หน้านี้ไม่มีอะไรเลย
// มันแค่ส่งผู้ใช้ไปที่หน้า /profile
export default function SettingsPage() {
  redirect('/settings/profile')
}