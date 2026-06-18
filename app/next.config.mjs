import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Load monorepo root .env so NEXT_PUBLIC_* vars set there are visible to Next.js.
// Next.js only looks in the app directory by default; this bridges the gap.
try {
  process.loadEnvFile(path.resolve(__dirname, '../.env'));
} catch {
  // File not found or already loaded — ignore.
}

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
