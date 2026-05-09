const { google } = require("googleapis");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const timeoutWebhookUrl = process.env.TIMEOUT_WEBHOOK_URL;
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!timeoutWebhookUrl || !spreadsheetId || !serviceAccountKey) {
    console.error("Saknade miljövariabler");
    return { statusCode: 500, body: "Konfigurationsfel" };
  }

  const params = new URLSearchParams(event.body || "");
  const customerPhone = params.get("from");
  const elkNumber = params.get("to");

  if (!customerPhone || !elkNumber) {
    console.error("Saknade fält i anropet från 46elks:", { customerPhone, elkNumber });
    return { statusCode: 400, body: "Saknade fält: from och/eller to" };
  }

  let credentials;
  try {
    credentials = JSON.parse(serviceAccountKey);
  } catch {
    console.error("Ogiltig JSON i GOOGLE_SERVICE_ACCOUNT_KEY");
    return { statusCode: 500, body: "Konfigurationsfel: ogiltig service account" };
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  let rows;
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "A:Z",
    });
    rows = response.data.values;
  } catch (err) {
    console.error("Google Sheets-fel:", err.message);
    return { statusCode: 502, body: "Kunde inte hämta data från Google Sheets" };
  }

  if (!rows || rows.length < 2) {
    return { statusCode: 404, body: "Inga rader hittades i Google Sheets" };
  }

  const headers = rows[0];
  const elkCol = headers.indexOf("elk_number");
  const companyCol = headers.indexOf("company_name");
  const phoneCol = headers.indexOf("sender_phone");

  if (elkCol === -1 || companyCol === -1 || phoneCol === -1) {
    console.error("Saknade kolumner i sheetet:", { elkCol, companyCol, phoneCol });
    return { statusCode: 500, body: "Felaktig sheetstruktur" };
  }

  const matchRow = rows.slice(1).find((row) => row[elkCol] === elkNumber);

  if (!matchRow) {
    console.error(`Inget 46elks-nummer hittades i sheetet: ${elkNumber}`);
    return { statusCode: 404, body: "Inget matchande nummer i Google Sheets" };
  }

  const companyName = matchRow[companyCol] || "";
  const senderPhone = matchRow[phoneCol] || "";

  const nextUrl = new URL(timeoutWebhookUrl);
  nextUrl.searchParams.set("customer_phone", customerPhone);
  nextUrl.searchParams.set("elk_number", elkNumber);
  nextUrl.searchParams.set("company_name", companyName);
  nextUrl.searchParams.set("sender_phone", senderPhone);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      say: "Vi kan inte svara just nu, vi hör av oss inom kort.",
      next: nextUrl.toString(),
    }),
  };
};
