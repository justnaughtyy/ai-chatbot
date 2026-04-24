// import type { Metadata } from "next";
// import { Inter } from "next/font/google";
// import "./globals.css";
// import { AuthProvider } from "@/contexts/AuthContext"; // 1. Import เข้ามา

// const inter = Inter({ subsets: ["latin"] });

// export const metadata: Metadata = {
//   title: "University AI Chatbot",
//   description: "โปรเจกต์จบสำหรับนักศึกษา IT",
// };

// export default function RootLayout({
//   children,
// }: Readonly<{
//   children: React.ReactNode;
// }>) {
//   return (
//     <html lang="en">
//       <body className={inter.className}>
//         <AuthProvider> {/* 2. นำไปครอบ children */}
//           {children}
//         </AuthProvider>
//       </body>
//     </html>
//   );
// }

// app/layout.tsx
// import type { Metadata } from 'next'
// import { Inter } from 'next/font/google'
// import './globals.css' // (shadcn/ui จะสร้างไฟล์นี้ให้)
// import { ThemeProvider } from '@/_components/ThemeProvider' // (แก้ path ให้ถูก)
// import { AuthProvider } from '@/contexts/AuthContext' // (ดึง AuthProvider ของคุณมา)

// const inter = Inter({ subsets: ['latin'] })

// export const metadata: Metadata = {
//   title: 'University AI Chatbot',
// }

// export default function RootLayout({
//   children,
// }: {
//   children: React.ReactNode
// }) {
//   return (
//     <html lang="en" suppressHydrationWarning>
//       <body className={inter.className}>
//         <AuthProvider> {/* หุ้มด้วย AuthProvider เดิมของคุณ */}
//           <ThemeProvider
//             attribute="class"
//             defaultTheme="system"
//             enableSystem
//             disableTransitionOnChange
//           >
//             {children}
//           </ThemeProvider>
//         </AuthProvider>
//       </body>
//     </html>
//   )
// }

//new
import { Toaster } from "@/components/ui/sonner" // ‼️ V35 FIX: เปลี่ยนที่ Import
import { ThemeProvider } from '@/_components/ThemeProvider'
import { AuthProvider } from '@/contexts/AuthContext'
import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'University AI Chatbot',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <AuthProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            {children}
            <Toaster /> {/* ‼️ V35 FIX: บรรทัดนี้เหมือนเดิม (แต่ตอนนี้มันคือ Toaster ของ Sonner) */}
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  )
}