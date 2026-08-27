#!/usr/bin/env node
// End-to-end smoke test for the core OpenSign/SignToowix flows, run directly
// against a live Parse Server instance over its REST/Cloud Function API.
//
// Covers: register -> login -> session validation (the server-side half of
// the "session expired on refresh from root URL" bug fixed on 2026-08-14) ->
// 2FA/OTP setup+verify -> document create/fetch/decline -> a password-reset
// email trigger.
//
// This talks to ONE already-running Parse Server mount (SERVER_URL). It does
// NOT drive a browser, so it cannot reproduce the browser-only half of the
// session bug (localStorage + window.location.origin handling in App.jsx /
// ValidateRoute.jsx / HomeLayout.jsx) - see the printed note at the end of
// the SESSION step for the manual repro steps that cover that part.
//
// Usage:
//   SERVER_URL=http://localhost:8081/app \
//   APP_ID=opensign \
//   MONGODB_URI=mongodb://username:password@localhost:27017/opensign \
//   node scripts/flow-check.js
//
// MONGODB_URI is optional but required for the OTP step (it peeks the OTP
// value directly out of the DB, standing in for reading a real inbox since
// this environment has no real SMTP/Mailgun credentials configured).
// Without it, the OTP step is reported as SKIPPED rather than failed.
//
// Set CLEANUP=false to keep the test user/tenant/document around for manual
// inspection afterwards (default: cleans up on success).

import { MongoClient } from "mongodb";

const SERVER_URL = (process.env.SERVER_URL || "http://localhost:8081/app").replace(/\/+$/, "");
const APP_ID = process.env.APP_ID || "opensign";
const MONGODB_URI = process.env.MONGODB_URI || "";
const CLEANUP = process.env.CLEANUP !== "false";

const runId = Date.now().toString(36);
const TEST_EMAIL = `flow-check-${runId}@example.test`;
const TEST_PASSWORD = `FlowCheck!${runId}`;

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  const tag = pass === "SKIP" ? "SKIP" : pass ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name}${detail ? " - " + detail : ""}`);
}

async function callFn(name, params, sessionToken) {
  const headers = {
    "Content-Type": "application/json",
    "X-Parse-Application-Id": APP_ID
  };
  if (sessionToken) headers["X-Parse-Session-Token"] = sessionToken;
  const res = await fetch(`${SERVER_URL}/functions/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(params || {})
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const err = new Error(json.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json.result;
}

async function restGet(path, sessionToken) {
  const headers = { "X-Parse-Application-Id": APP_ID };
  if (sessionToken) headers["X-Parse-Session-Token"] = sessionToken;
  const res = await fetch(`${SERVER_URL}${path}`, { headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const err = new Error(json.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

let mongoClient = null;
async function getMongo() {
  if (!MONGODB_URI) return null;
  if (!mongoClient) {
    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
  }
  return mongoClient.db();
}

// ---------------------------------------------------------------------------

async function checkServerUp() {
  try {
    const res = await fetch(`${SERVER_URL.replace(/\/app$/, "")}/`, { method: "GET" });
    record("server reachable", res.status < 500, `HTTP ${res.status} from ${SERVER_URL}`);
  } catch (e) {
    record("server reachable", false, e.message);
    throw e; // nothing else can run without a live server
  }
}

async function checkRegister() {
  try {
    const res = await callFn("addadmin", {
      userDetails: {
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        name: "Flow Check",
        company: `FlowCheck Co ${runId}`,
        role: "contracts_Admin"
      }
    });
    const ok = !!res?.sessionToken;
    record("register (addadmin)", ok, ok ? `account created for ${TEST_EMAIL}` : JSON.stringify(res));
    return res;
  } catch (e) {
    record("register (addadmin)", false, e.message);
    return null;
  }
}

async function checkLogin() {
  try {
    const res = await callFn("loginuser", { email: TEST_EMAIL, password: TEST_PASSWORD });
    const ok = !!res?.sessionToken;
    record("login (loginuser)", ok, ok ? "sessionToken issued" : JSON.stringify(res));
    return res;
  } catch (e) {
    record("login (loginuser)", false, e.message);
    return null;
  }
}

async function checkSessionValidation(sessionToken) {
  try {
    // This is the exact server-side call ValidateRoute.jsx / HomeLayout.jsx
    // now make via Parse.User.become(token) after the fix.
    const me = await restGet("/users/me", sessionToken);
    const ok = !!me?.objectId;
    record(
      "session validates via /users/me (server-side half of the refresh fix)",
      ok,
      ok ? `token resolves to user ${me.objectId}` : JSON.stringify(me)
    );
  } catch (e) {
    record("session validates via /users/me", false, e.message);
  }
  console.log(
    "  NOTE: this only proves the server accepts the token. The bug fixed on 2026-08-14 " +
      "was a BROWSER-side localStorage/window.location.origin issue (App.jsx, ValidateRoute.jsx, " +
      "HomeLayout.jsx) and needs a manual/browser check: log in, open a dashboard URL, edit the " +
      "address bar to the site root and hit Enter, then hard-refresh (F5) - you should stay logged in " +
      "with no 'Session Expired' popup."
  );
}

async function checkOtpFlow(sessionToken, userObjectId) {
  try {
    const send = await callFn("sendtwofactorsetupotp", {}, sessionToken);
    record("2FA: send setup OTP", true, JSON.stringify(send));
  } catch (e) {
    record("2FA: send setup OTP", false, e.message);
    return;
  }

  const db = await getMongo();
  if (!db) {
    record("2FA: verify setup OTP", "SKIP", "no MONGODB_URI provided, cannot read the OTP without real email");
    return;
  }
  try {
    const extUser = await db.collection("contracts_Users").findOne({ Email: TEST_EMAIL });
    if (!extUser) throw new Error("contracts_Users record not found for test email");
    const otpDoc = await db.collection("contracts_TwoFactorOtp").findOne(
      { ExtUserId: { $exists: true }, Purpose: "setup" },
      { sort: { createdAt: -1 } }
    );
    // Narrow to this user's own OTP (ExtUserId is a Parse pointer field).
    const mine = await db.collection("contracts_TwoFactorOtp").findOne({
      Purpose: "setup",
      "ExtUserId.objectId": extUser._id
    });
    const otp = (mine || otpDoc)?.OTP;
    if (!otp) throw new Error("no pending setup OTP found in contracts_TwoFactorOtp");

    const verify = await callFn("verifytwofactorsetupotp", { otp }, sessionToken);
    record("2FA: verify setup OTP", true, JSON.stringify(verify));

    // Leave 2FA disabled again so it doesn't interfere with a re-run's login step.
    await callFn("disabletwofactor", {}, sessionToken).catch(() => {});
  } catch (e) {
    record("2FA: verify setup OTP", false, e.message);
  }
}

async function checkDocumentFlow(sessionToken) {
  let extUser;
  try {
    extUser = await callFn("getUserDetails", {}, sessionToken);
    record("document: resolve ExtUserPtr", !!extUser?.objectId, extUser?.objectId);
  } catch (e) {
    record("document: resolve ExtUserPtr", false, e.message);
    return;
  }

  let doc;
  try {
    doc = await callFn(
      "createdocumentfromapp",
      {
        document: {
          Name: `Flow check doc ${runId}`,
          URL: "https://example.com/flow-check.pdf",
          ExtUserPtr: { __type: "Pointer", className: "contracts_Users", objectId: extUser.objectId },
          CreatedBy: { __type: "Pointer", className: "_User", objectId: extUser.UserId?.objectId }
        }
      },
      sessionToken
    );
    record("document: create", !!doc?.objectId, doc?.objectId);
  } catch (e) {
    record("document: create", false, e.message);
    return;
  }

  try {
    const fetched = await callFn("getDocument", { docId: doc.objectId }, sessionToken);
    const ok = Array.isArray(fetched) ? fetched.length > 0 : !!fetched;
    record("document: fetch back (getDocument)", ok);
  } catch (e) {
    record("document: fetch back (getDocument)", false, e.message);
  }

  try {
    await callFn("declinedoc", { docId: doc.objectId, userId: extUser.objectId }, sessionToken);
    record("document: decline (declinedoc)", true);
  } catch (e) {
    record("document: decline (declinedoc)", false, e.message);
  }

  return doc?.objectId;
}

async function checkEmailTrigger() {
  try {
    const res = await fetch(`${SERVER_URL}/requestPasswordReset`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Parse-Application-Id": APP_ID },
      body: JSON.stringify({ email: TEST_EMAIL })
    });
    // Parse deliberately never reveals whether the address exists, so any
    // non-5xx response means the request was accepted and (if this server
    // has real SMTP/Mailgun credentials) an email was queued.
    record(
      "email trigger: password reset request",
      res.status < 500,
      `HTTP ${res.status} - cannot confirm actual inbox delivery without real SMTP/Mailgun creds`
    );
  } catch (e) {
    record("email trigger: password reset request", false, e.message);
  }
}

async function cleanup(userObjectId, docObjectId) {
  if (!CLEANUP) {
    console.log(`\nCLEANUP=false - leaving test account ${TEST_EMAIL} / doc ${docObjectId} in place.`);
    return;
  }
  const db = await getMongo();
  if (!db) {
    console.log(`\nNo MONGODB_URI - could not clean up test account ${TEST_EMAIL}. Remove it manually.`);
    return;
  }
  try {
    const extUser = await db.collection("contracts_Users").findOne({ Email: TEST_EMAIL });
    if (docObjectId) await db.collection("contracts_Document").deleteMany({ _id: docObjectId });
    if (extUser) {
      await db.collection("contracts_TwoFactorOtp").deleteMany({ "ExtUserId.objectId": extUser._id });
      await db.collection("partners_Tenant").deleteMany({ EmailAddress: TEST_EMAIL });
      await db.collection("contracts_Users").deleteMany({ Email: TEST_EMAIL });
    }
    if (userObjectId) await db.collection("_User").deleteMany({ _id: userObjectId });
    console.log(`\nCleaned up test data for ${TEST_EMAIL}.`);
  } catch (e) {
    console.log(`\nCleanup failed (non-fatal): ${e.message}`);
  }
}

async function main() {
  console.log(`Running flow-check against ${SERVER_URL} (app id: ${APP_ID})\n`);

  try {
    await checkServerUp();
  } catch (e) {
    console.log(`\nCannot reach ${SERVER_URL} (${e.message}). Is the server running? Aborting.`);
    process.exitCode = 1;
    return;
  }

  const registered = await checkRegister();
  const login = registered ? await checkLogin() : null;

  if (login?.sessionToken) {
    await checkSessionValidation(login.sessionToken);
    await checkOtpFlow(login.sessionToken, login.objectId);
    const docId = await checkDocumentFlow(login.sessionToken);
    await checkEmailTrigger();
    await cleanup(login.objectId, docId);
  } else {
    console.log("\nSkipping session/OTP/document/email checks - login did not succeed.");
  }

  if (mongoClient) await mongoClient.close();

  const failed = results.filter((r) => r.pass === false);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log("Failed checks:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("\nflow-check aborted:", e);
  process.exitCode = 1;
});
