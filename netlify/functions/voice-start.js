const { google } = require("googleapis");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const timeoutWebhookUrl = process.env.TIMEOUT_WEBHOOK_URL;
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!timeoutWebhookUrl || !spreadsheetId || !serviceAccountKey) {
    console.error("Saknade miljövariabler: TIMEOUT_WEBHOOK_URL, GOOGLE_SHEETS_ID eller GOOGLE_SERVICE_ACCOUNT_KEY");
    return { statusCode: 500, body: "Konfigurationsfel" };
  }

  // Hämta "to"-fältet från 46elks POST-body (vilket 46elks-nummer som ringdes)
  const params = new URLSearchParams(event.body || "");
  const elkNumber = params.get("to");

  if (!elkNumber) {
    console.error("Saknat 'to'-fält i anropet från 46elks");
    return { statusCode: 400, body: "Saknat fält: to" };
  }

  let credentials;
  try {
    credentials = JSON.parse(serviceAccountKey);
  } catch {
    console.error("Ogiltig JSON i GOOGLE_SERVICE_ACCOUNT_KEY");
    return { statusCode: 500, body: "Konfigurationsfel: ogiltig service account" };
  }

  // Autentisera mot Google Sheets med service account
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

  // Hitta kolumnindex för elk_number och sender_phone
  const headers = rows[0];
  const elkCol = headers.indexOf("elk_number");
  const phoneCol = headers.indexOf("sender_phone");

  if (elkCol === -1 || phoneCol === -1) {
    console.error("Kolumnerna 'elk_number' eller 'sender_phone' saknas i sheetet");
    return { statusCode: 500, body: "Felaktig sheetstruktur" };
  }

  // Sök upp raden med matchande elk_number
  const matchRow = rows.slice(1).find((row) => row[elkCol] === elkNumber);

  if (!matchRow) {
    console.error(`Inget 46elks-nummer hittades i sheetet: ${elkNumber}`);
    return { statusCode: 404, body: "Inget matchande nummer i Google Sheets" };
  }

  const hantverkareNummer = matchRow[phoneCol];

  if (!hantverkareNummer) {
    console.error(`sender_phone saknas för elk_number: ${elkNumber}`);
    return { statusCode: 404, body: "Hantverarens nummer saknas" };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      connect: hantverkareNummer,
      timeout: 15,
      next: timeoutWebhookUrl,
    }),
  };
};
