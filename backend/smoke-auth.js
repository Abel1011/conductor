require("dotenv").config();
const { BigQuery } = require("@google-cloud/bigquery");
const config = require("./src/lib/config");

(async () => {
  try {
    const client = new BigQuery({
      projectId: config.bigQueryProjectId || process.env.BIGQUERY_PROJECT_ID,
      credentials: config.googleCredentials,
    });
    const [rows] = await client.query({
      query: "SELECT COUNT(*) AS policies FROM `conductor.connection_policy`",
      location: process.env.BIGQUERY_LOCATION,
    });
    console.log("BigQuery SA auth OK:", JSON.stringify(rows));
  } catch (e) {
    console.log("ERROR:", String(e.message || e).slice(0, 400));
  }
})();
