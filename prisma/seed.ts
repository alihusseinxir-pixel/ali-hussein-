import { PrismaClient, type Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();
const PASSWORD = process.env.SEED_PASSWORD ?? "basma-demo-123";

async function main() {
  const org = await db.organization.upsert({ where: { slug: "demo" }, update: {}, create: { name: "Demo Marketing Co.", slug: "demo" } });
  const hash = await bcrypt.hash(PASSWORD, 12);
  const people: [string, string, Role][] = [
    ["Admin", "admin@demo.test", "ADMIN"],
    ["Mona (Marketing Mgr)", "manager@demo.test", "MARKETING_MANAGER"],
    ["Ali (Social Media)", "social@demo.test", "SOCIAL_MEDIA_MANAGER"],
    ["Ahmed (Videographer)", "video@demo.test", "VIDEOGRAPHER"],
    ["Sara (Photographer)", "photo@demo.test", "PHOTOGRAPHER"],
    ["Mohammed (Editor)", "editor@demo.test", "VIDEO_EDITOR"],
    ["Lina (Designer)", "designer@demo.test", "DESIGNER"],
  ];
  for (const [name, email, role] of people) {
    await db.user.upsert({ where: { email }, update: {}, create: { organizationId: org.id, name, email, role, passwordHash: hash } });
  }
  const brand = await db.brand.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "TAZAJ" } },
    update: {},
    create: { organizationId: org.id, name: "TAZAJ" },
  });
  await db.campaign.upsert({
    where: { organizationId_brandId_name: { organizationId: org.id, brandId: brand.id, name: "Fresh With You" } },
    update: {},
    create: { organizationId: org.id, brandId: brand.id, name: "Fresh With You" },
  });
  console.log(`Seeded. Log in as admin@demo.test / ${PASSWORD}`);
}

main().finally(() => db.$disconnect());
