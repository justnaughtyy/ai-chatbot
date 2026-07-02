import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: '/',
        destination: '/chat',
        permanent: true, // ตั้งเป็น true เพื่อให้บอทค้นหา (SEO) รู้ว่าย้ายหน้าถาวร
      },
    ]
  },
};

export default nextConfig;