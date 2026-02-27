// lib/prismaClient.js
export async function getPrismaClient() {
  const mod = await import("@prisma/client");
  const PrismaClient = mod?.PrismaClient;
  if (!PrismaClient) return null;

  if (!globalThis.__regorixa_prisma) {
    globalThis.__regorixa_prisma = new PrismaClient();
  }
  return globalThis.__regorixa_prisma;
}
