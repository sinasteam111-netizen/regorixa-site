const { readUsers, writeUsers } = require("../lib/userStore.js");

async function run() {
  const users = await readUsers();
  let totalRemoved = 0;

  for (const u of users) {
    if (!Array.isArray(u.securityLog)) continue;

    const before = u.securityLog.length;

    u.securityLog = u.securityLog.filter((e) => {
      const ip = String(e?.ip || "");
      return !(
        ip === "::1" ||
        ip === "127.0.0.1" ||
        ip === "unknown" ||
        ip === "1"
      );
    });

    totalRemoved += before - u.securityLog.length;
  }

  await writeUsers(users);
  console.log(`✅ Cleanup done. Removed ${totalRemoved} log entries.`);
}

run().catch((e) => {
  console.error("❌ Cleanup failed:", e);
  process.exit(1);
});
