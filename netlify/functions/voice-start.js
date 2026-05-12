const { google } = require("googleapis");
const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { TIMEOUT_WEBHOOK_URL, GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_KEY } = process.env;

  if (!TIMEOUT_WEBHOOK_URL || !GOOGLE_SHEETS_ID || !GOOGLE_SERVICE_ACCOUNT_KEY) {
    console.error("Saknade miljövariabler: TIMEOUT_WEBHOOK_URL, GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_KEY");
    return hangup();
  }

  // 46elks skickar from (kundens nummer), to (elk_number), callid (unikt samtal-ID)
  const params = new URLSearchParams(event.body || "");
  const customerPhone = params.get("from");
  const elkNumber = params.get("to");
  const callId = params.get("callid");

  // Dedupliceringskontroll: om samma callid redan behandlats inom 5 minuter, avbryt direkt
  if (callId) {
    try {
      const store = getStore("call-dedup");
      const alreadySeen = await store.get(callId);
      if (alreadySeen) {
        console.log("Duplikat callid ignorerat:", callId);
        return hangup();
      }
      // Märk callid som hanterat, TTL 300 sekunder (5 minuter)
      await store.set(callId, "1", { ttl: 300 });
    } catch (e) {
      // Om Blobs inte är tillgängligt loggar vi felet men blockerar inte samtalet
      console.error("Dedup-cache fel (fortsätter ändå):", e.message);
    }
  }

  if (!customerPhone || !elkNumber) {
    console.error("Saknade fält från 46elks:", { customerPhone, elkNumber });
    return hangup();
  }

  let credentials;
  try {
    credentials = JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY);
  } catch (e) {
    console.error("Ogiltig JSON i GOOGLE_SERVICE_ACCOUNT_KEY:", e.message);
    return hangup();
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  let rows;
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEETS_ID,
      range: "A:Z",
    });
    rows = response.data.values;
  } catch (e) {
    console.error("Google Sheets-fel:", e.message);
    return hangup();
  }

  if (!rows || rows.length < 2) {
    console.error("Inga rader i Google Sheets");
    return hangup();
  }

  const headers = rows[0];
  const elkCol = headers.indexOf("elk_number");
  const phoneCol = headers.indexOf("sender_phone");
  const companyCol = headers.indexOf("company_name");

  if (elkCol === -1 || phoneCol === -1 || companyCol === -1) {
    console.error("Saknade kolumner i sheetet. Hittade:", headers.join(", "));
    return hangup();
  }

  const matchRow = rows.slice(1).find((row) => row[elkCol] === elkNumber);
  if (!matchRow) {
    console.error("Inget matchande elk_number i sheetet:", elkNumber);
    return hangup();
  }

  const senderPhone = matchRow[phoneCol] || "";
  const companyName = matchRow[companyCol] || "";

  if (!senderPhone) {
    console.error("Tomt sender_phone för elk_number:", elkNumber);
    return hangup();
  }

  const webhookUrl = new URL(TIMEOUT_WEBHOOK_URL);
  webhookUrl.searchParams.set("customer_phone", customerPhone);
  webhookUrl.searchParams.set("elk_number", elkNumber);
  webhookUrl.searchParams.set("company_name", companyName);
  webhookUrl.searchParams.set("sender_phone", senderPhone);

  console.log(`[${callId || "no-callid"}] Kopplar ${customerPhone} → ${senderPhone} (${companyName}), timeout 15s`);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      connect: senderPhone,
      timeout: "15",
      busy: { hangup: "" },
      failed: { hangup: "" },
      whenhangup: webhookUrl.toString(),
    }),
  };
};

function hangup() {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hangup: "" }),
  };
}
