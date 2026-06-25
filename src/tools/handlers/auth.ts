import path from "node:path";
import { promises as fs } from "node:fs";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.test.json");
const TOKEN_PATH = path.join(process.cwd(), "token.test.json");

export async function getAuthClient() {
  try {
    const token = await fs.readFile(TOKEN_PATH, "utf-8");
    const credentials = await fs.readFile(CREDENTIALS_PATH, "utf-8");

    const parsedCredentials = JSON.parse(credentials);
    const clientConfig = parsedCredentials.installed ?? parsedCredentials.web;

    if (!clientConfig) {
      throw new Error(
        "Invalid credentials.test.json: expected installed or web OAuth client config."
      );
    }

    const oauth2Client = new google.auth.OAuth2(
      clientConfig.client_id,
      clientConfig.client_secret,
      clientConfig.redirect_uris[0]
    );

    oauth2Client.setCredentials(JSON.parse(token));

    return oauth2Client;
  } catch {
    const client = await authenticate({
      scopes: SCOPES,
      keyfilePath: CREDENTIALS_PATH,
    });

    if (!client.credentials) {
      throw new Error("Google OAuth finished but no credentials were returned.");
    }

    await fs.writeFile(
      TOKEN_PATH,
      JSON.stringify(client.credentials, null, 2),
      "utf-8"
    );

    const credentials = await fs.readFile(CREDENTIALS_PATH, "utf-8");
    const parsedCredentials = JSON.parse(credentials);
    const clientConfig = parsedCredentials.installed ?? parsedCredentials.web;

    const oauth2Client = new google.auth.OAuth2(
      clientConfig.client_id,
      clientConfig.client_secret,
      clientConfig.redirect_uris[0]
    );

    oauth2Client.setCredentials(client.credentials);

    return oauth2Client;
  }
}