/**
 * Exhaustive scope test for the MicroPython device code client.
 * Usage: npx tsx scripts/test-micropython-scopes.ts
 */

const DEVICE_CODE_ENDPOINT = "https://oauth2.googleapis.com/device/code";
const clientId =
  "648445354032-mv5p4b09hcj0116v57pnkmp42fn8m220.apps.googleusercontent.com";

const scopes: [string, string][] = [
  ["Gmail full", "https://mail.google.com/"],
  ["Gmail readonly", "https://www.googleapis.com/auth/gmail.readonly"],
  ["Gmail send", "https://www.googleapis.com/auth/gmail.send"],
  ["Gmail modify", "https://www.googleapis.com/auth/gmail.modify"],
  ["Gmail labels", "https://www.googleapis.com/auth/gmail.labels"],
  ["Calendar full", "https://www.googleapis.com/auth/calendar"],
  ["Calendar readonly", "https://www.googleapis.com/auth/calendar.readonly"],
  ["Calendar events", "https://www.googleapis.com/auth/calendar.events"],
  [
    "Calendar + email combo",
    "https://www.googleapis.com/auth/calendar openid email",
  ],
  ["Tasks", "https://www.googleapis.com/auth/tasks"],
  ["Tasks readonly", "https://www.googleapis.com/auth/tasks.readonly"],
  ["Drive", "https://www.googleapis.com/auth/drive"],
  ["Drive file", "https://www.googleapis.com/auth/drive.file"],
  ["Drive readonly", "https://www.googleapis.com/auth/drive.readonly"],
  ["People/Contacts", "https://www.googleapis.com/auth/contacts.readonly"],
  ["CardDAV", "https://www.googleapis.com/auth/carddav"],
  ["UserInfo email", "https://www.googleapis.com/auth/userinfo.email"],
  ["UserInfo profile", "https://www.googleapis.com/auth/userinfo.profile"],
  ["YouTube readonly", "https://www.googleapis.com/auth/youtube.readonly"],
  [
    "Photos readonly",
    "https://www.googleapis.com/auth/photoslibrary.readonly",
  ],
  ["Keep", "https://www.googleapis.com/auth/keep"],
  ["openid", "openid"],
  ["email", "email"],
  ["profile", "profile"],
  [
    "ALL: cal+email+openid",
    "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email openid",
  ],
];

async function test(name: string, scope: string) {
  const res = await fetch(DEVICE_CODE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scope }),
  });
  const data = await res.json();
  if (res.ok && data.device_code) {
    console.log(`  ✅ ${name.padEnd(28)}`);
  } else {
    console.log(
      `  ❌ ${name.padEnd(28)} ${data.error_description || data.error}`
    );
  }
  await new Promise((r) => setTimeout(r, 250));
}

async function main() {
  console.log("MicroPython client - Device code flow scope test");
  console.log("=".repeat(70));
  for (const [name, scope] of scopes) {
    await test(name, scope);
  }
}

main().catch(console.error);
