// Local only: plays Razorpay for apps/api's FakeRazorpay (APP_ENV=local or test). After the web
// checkout's test approve step, the API waits for Razorpay's `subscription.activated` webhook; this
// sends it, signed with the API's dev webhook secret (a local placeholder read from the API
// source, never a real key), so PAY-08 sees Pro.
//
//   node scripts/fake-razorpay.mjs <subscription_id> <user_id> [intro=1] [api=http://127.0.0.1:8000]
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, "..", "..", "api");

function devWebhookSecret() {
  const src = readFileSync(join(apiDir, "smriti_api", "integrations", "__init__.py"), "utf8");
  const m = src.match(/DEV_RAZORPAY_WEBHOOK_SECRET\s*=\s*"([^"]+)"/);
  if (!m) throw new Error("the API's dev webhook secret was not found");
  return m[1];
}

/** Sends a signed `subscription.activated` webhook for one subscription. */
export async function activateSubscription({ api = "http://127.0.0.1:8000", subscriptionId, userId, intro = true }) {
  const template = readFileSync(join(apiDir, "tests", "fixtures", "billing", "razorpay_subscription.json.tmpl"), "utf8");
  const now = Math.floor(Date.now() / 1000);
  const end = new Date();
  end.setMonth(end.getMonth() + 1);
  const values = {
    EVENT: "subscription.activated",
    SUB_ID: subscriptionId,
    SUB_STATUS: "activated",
    CURRENT_START: now,
    CURRENT_END: Math.floor(end.getTime() / 1000),
    USER_ID: userId,
    INTRO: intro ? "1" : "0",
    PAID_COUNT: 1,
    OFFER_ID: intro ? '"offer_FixtureIntro"' : "null",
    PAYMENT_ID: `pay_${randomBytes(7).toString("hex")}`,
    AMOUNT: intro ? 100 : 9900,
    CREATED_AT: now,
  };
  let body = template;
  for (const [k, v] of Object.entries(values)) body = body.replaceAll(`{{${k}}}`, String(v));
  const sig = createHmac("sha256", devWebhookSecret()).update(body).digest("hex");
  const r = await fetch(`${api}/v1/webhooks/razorpay`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Razorpay-Signature": sig, "X-Razorpay-Event-Id": `evt_${randomBytes(7).toString("hex")}` },
    body,
  });
  if (!r.ok) throw new Error(`webhook ${r.status}: ${await r.text()}`);
  return r.json();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [subscriptionId, userId, intro = "1", api] = process.argv.slice(2);
  if (!subscriptionId || !userId) {
    console.error("usage: node scripts/fake-razorpay.mjs <subscription_id> <user_id> [intro=1] [api]");
    process.exit(2);
  }
  console.log(await activateSubscription({ subscriptionId, userId, intro: intro === "1", api }));
}
