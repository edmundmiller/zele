/**
 * Test Google OAuth client IDs for device code flow support.
 * These are candidates that might be registered as "TV/Limited Input" type.
 *
 * Usage: npx tsx scripts/test-device-code-clients.ts
 */

interface OAuthClient {
  name: string;
  clientId: string;
  clientSecret: string;
  source: string;
}

const CLIENTS: OAuthClient[] = [
  {
    name: "Smallstep CLI (device authz)",
    clientId:
      "1087160488420-8qt7bavg3qesdhs6it824mhnfgcfe8il.apps.googleusercontent.com",
    clientSecret: "udTrOT3gzrO7W9fDPgZQLfYJ",
    source: "github.com/smallstep/cli - defaultDeviceAuthzClientID",
  },
  {
    name: "Google Cloud SDK (gcloud)",
    clientId:
      "764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com",
    clientSecret: "d-FL95Q19q7MQmFpd7hHD0Ty",
    source: "google-cloud-sdk (well-known public client)",
  },
  {
    name: "MicroPython OAuth2 example",
    clientId:
      "648445354032-mv5p4b09hcj0116v57pnkmp42fn8m220.apps.googleusercontent.com",
    clientSecret: "",
    source: "github.com/micropython/micropython-lib PR",
  },
  {
    name: "OIDC Bash Client",
    clientId:
      "947227895516-68tp60nti613r42u41bch5vesr5iqpbi.apps.googleusercontent.com",
    clientSecret: "",
    source: "github.com/please-openit/oidc-bash-client",
  },
  // Also re-test existing ones for comparison
  {
    name: "Thunderbird Desktop",
    clientId:
      "406964657835-aq8lmia8j95dhl1a2bvharmfk3t1hgqj.apps.googleusercontent.com",
    clientSecret: "kSmqreRr0qwBWJgbf5Y-PjSU",
    source: "searchfox.org/comm-central",
  },
  {
    name: "GNOME Online Accounts",
    clientId:
      "44438659992-7kgjeitenc16ssihbtdjbgguch7ju55s.apps.googleusercontent.com",
    clientSecret: "-gMLuQyDiI0XrQS_vx_mhuYF",
    source: "github.com/GNOME/gnome-online-accounts",
  },
];

// Scopes we care about
const SCOPES_TO_TEST: Record<string, string> = {
  "Gmail (full)": "https://mail.google.com/",
  Calendar: "https://www.googleapis.com/auth/calendar",
  "Calendar (readonly)": "https://www.googleapis.com/auth/calendar.readonly",
  Contacts: "https://www.googleapis.com/auth/carddav",
  Drive: "https://www.googleapis.com/auth/drive",
  Tasks: "https://www.googleapis.com/auth/tasks",
  "UserInfo (email)": "https://www.googleapis.com/auth/userinfo.email",
  openid: "openid",
};

const DEVICE_CODE_ENDPOINT = "https://oauth2.googleapis.com/device/code";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

async function testDeviceCode(
  client: OAuthClient,
  scope: string
): Promise<{ ok: boolean; data: any }> {
  const res = await fetch(DEVICE_CODE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.clientId,
      scope,
    }),
  });
  return { ok: res.ok, data: await res.json() };
}

async function testScopeViaRefresh(
  client: OAuthClient,
  scopeValue: string
): Promise<{ enabled: boolean; error?: string }> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: "1//dummy_refresh_token_probe",
      grant_type: "refresh_token",
      scope: scopeValue,
    }),
  });
  const data = await res.json();
  const err = data.error || "";
  if (err === "invalid_grant") return { enabled: true };
  if (err === "invalid_scope")
    return { enabled: false, error: data.error_description };
  // invalid_client could mean bad secret, but scope might still work via device code
  return { enabled: true, error: `${err}: ${data.error_description || ""}` };
}

async function main() {
  console.log("=".repeat(80));
  console.log("Device Code Flow + Scope Capability Tester");
  console.log("=".repeat(80));

  for (const client of CLIENTS) {
    console.log(`\n${"━".repeat(80)}`);
    console.log(`CLIENT: ${client.name}`);
    console.log(`ID:     ${client.clientId}`);
    console.log(`Source: ${client.source}`);
    console.log(`${"━".repeat(80)}`);

    // 1. Test device code flow with a basic scope
    console.log("\n[1] Device Code Flow Test (scope: openid email)");
    const dc = await testDeviceCode(client, "openid email");
    if (dc.ok && dc.data.device_code) {
      console.log(`    ✅ SUPPORTED`);
      console.log(`    verification_url: ${dc.data.verification_url}`);
      console.log(`    user_code:        ${dc.data.user_code}`);
      console.log(`    expires_in:       ${dc.data.expires_in}s`);
      console.log(`    interval:         ${dc.data.interval}s`);
    } else {
      console.log(
        `    ❌ NOT SUPPORTED: ${dc.data.error} - ${dc.data.error_description || ""}`
      );
    }

    // 2. If device code works, test it with each scope
    if (dc.ok && dc.data.device_code) {
      console.log("\n[2] Per-Scope Device Code Test");
      console.log(
        `    ${"Scope".padEnd(25)} ${"Device Code?".padEnd(14)} Notes`
      );
      console.log(`    ${"─".repeat(65)}`);

      for (const [scopeName, scopeValue] of Object.entries(SCOPES_TO_TEST)) {
        const r = await testDeviceCode(client, scopeValue);
        if (r.ok && r.data.device_code) {
          console.log(`    ${scopeName.padEnd(25)} ✅ YES`);
        } else {
          const err = r.data.error || "unknown";
          const desc = r.data.error_description || "";
          console.log(
            `    ${scopeName.padEnd(25)} ❌ NO            ${err}: ${desc}`
          );
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    } else {
      // Fallback: test scopes via token exchange
      console.log("\n[2] Scope Enablement (via refresh token probe)");
      console.log(
        `    ${"Scope".padEnd(25)} ${"Enabled?".padEnd(12)} Notes`
      );
      console.log(`    ${"─".repeat(65)}`);

      for (const [scopeName, scopeValue] of Object.entries(SCOPES_TO_TEST)) {
        const r = await testScopeViaRefresh(client, scopeValue);
        const icon = r.enabled ? "✅ YES" : "❌ NO";
        console.log(
          `    ${scopeName.padEnd(25)} ${icon.padEnd(12)} ${r.error || ""}`
        );
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log("Done!");
}

main().catch(console.error);
