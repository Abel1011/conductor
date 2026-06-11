const bigqueryProjectId = process.env.BIGQUERY_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "";

function getNumber(name, fallback) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getBoolean(name, fallback = false) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  return /^(1|true|yes|on)$/i.test(value);
}

function normalizeMultiline(value) {
  return typeof value === "string" ? value.replace(/\\n/g, "\n") : value;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined && entryValue !== null && entryValue !== "")
  );
}

function getGoogleCredentials() {
  const authType = process.env.GOOGLE_CLOUD_AUTH_TYPE || "";
  const clientEmail = process.env.GOOGLE_CLOUD_CLIENT_EMAIL || "";
  const privateKey = normalizeMultiline(process.env.GOOGLE_CLOUD_PRIVATE_KEY || "");
  const clientId = process.env.GOOGLE_CLOUD_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLOUD_CLIENT_SECRET || "";
  const refreshToken = process.env.GOOGLE_CLOUD_REFRESH_TOKEN || "";
  const quotaProjectId = process.env.GOOGLE_CLOUD_QUOTA_PROJECT_ID || "";
  const universeDomain = process.env.GOOGLE_CLOUD_UNIVERSE_DOMAIN || "";

  if (clientEmail && privateKey) {
    return compactObject({
      type: authType || "service_account",
      project_id: bigqueryProjectId || undefined,
      private_key_id: process.env.GOOGLE_CLOUD_PRIVATE_KEY_ID || undefined,
      private_key: privateKey,
      client_email: clientEmail,
      client_id: clientId || undefined,
      auth_uri: process.env.GOOGLE_CLOUD_AUTH_URI || undefined,
      token_uri: process.env.GOOGLE_CLOUD_TOKEN_URI || undefined,
      auth_provider_x509_cert_url: process.env.GOOGLE_CLOUD_AUTH_PROVIDER_X509_CERT_URL || undefined,
      client_x509_cert_url: process.env.GOOGLE_CLOUD_CLIENT_X509_CERT_URL || undefined,
      quota_project_id: quotaProjectId || undefined,
      universe_domain: universeDomain || undefined
    });
  }

  if (clientId && clientSecret && refreshToken) {
    return compactObject({
      type: authType || "authorized_user",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      quota_project_id: quotaProjectId || undefined,
      universe_domain: universeDomain || undefined
    });
  }

  return null;
}

const googleCredentials = getGoogleCredentials();
const googleAuthOptions = googleCredentials
  ? compactObject({
      credentials: googleCredentials,
      projectId: bigqueryProjectId || undefined
    })
  : undefined;

module.exports = {
  port: getNumber("PORT", 5000),
  internalTriggerSecret: process.env.INTERNAL_TRIGGER_SECRET || "local-conductor-secret",
  bigqueryProjectId,
  googleCredentials,
  googleAuthOptions,
  bigqueryLocation: process.env.BIGQUERY_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || process.env.GCP_REGION || "US",
  gcpRegion: process.env.GCP_REGION || process.env.GOOGLE_CLOUD_LOCATION || "us-central1",
  conductorDataset: process.env.CONDUCTOR_DATASET || "conductor",
  fivetranMetadataDataset: process.env.FIVETRAN_METADATA_DATASET || "fivetran_metadata",
  fivetranMetadataLocation: process.env.FIVETRAN_METADATA_LOCATION || "US",
  rawDatasets: [
    process.env.SHOP_RAW_DATASET || "shop_raw",
    process.env.MARKETING_RAW_DATASET || "marketing_raw"
  ],
  fivetranApiBaseUrl: process.env.FIVETRAN_API_BASE_URL || "https://api.fivetran.com/v1",
  fivetranActivationsConnectionId: process.env.FIVETRAN_ACTIVATIONS_CONNECTION_ID || "",
  marUsdPerMillion: getNumber("MAR_USD_PER_MILLION", 47),
  companyName: process.env.DEMO_COMPANY_NAME || "Conductor",
  accountLabel: process.env.FIVETRAN_ACCOUNT_LABEL || "Primary Fivetran account",
  webhookSecret: process.env.FIVETRAN_WEBHOOK_SECRET || "",
  fivetranConfigured: Boolean(process.env.FIVETRAN_API_KEY && process.env.FIVETRAN_API_SECRET),
  slackChannelId: process.env.SLACK_CHANNEL_ID || "",
  slackBotToken: process.env.SLACK_BOT_TOKEN || "",
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || "",
  notifyEmailFrom: process.env.NOTIFY_EMAIL_FROM || "",
  notifyEmailTo: process.env.NOTIFY_EMAIL_TO || "",
  resendApiKey: process.env.RESEND_API_KEY || ""
};
