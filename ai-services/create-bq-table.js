/**
 * Temporary script to create BigQuery audit table.
 * Run from project root: node ai-services/create-bq-table.js
 */
const { BigQuery } = require("@google-cloud/bigquery");
const fs = require("fs");
const path = require("path");

const bigquery = new BigQuery({ projectId: "datalake-production-sa" });

async function main() {
  const sql = fs.readFileSync(
    path.join(__dirname, "bq-ai-actions-schema.sql"),
    "utf8"
  );
  console.log("Creating BigQuery table datalake_audit.ai_actions...");
  
  // First ensure the dataset exists
  try {
    await bigquery.createDataset("datalake_audit", { location: "me-central2" });
    console.log("  Dataset datalake_audit created.");
  } catch (err) {
    if (err.code === 409) {
      console.log("  Dataset datalake_audit already exists.");
    } else {
      throw err;
    }
  }

  // Run the CREATE TABLE IF NOT EXISTS SQL
  const [job] = await bigquery.createQueryJob({ query: sql });
  console.log(`  Query job ${job.id} started...`);
  await job.getQueryResults();
  console.log("  Table created successfully.");

  // Verify
  const [table] = await bigquery
    .dataset("datalake_audit")
    .table("ai_actions")
    .get();
  console.log(`  Verified: ${table.metadata.tableReference.datasetId}.${table.metadata.tableReference.tableId}`);
  console.log(`  Schema fields: ${table.metadata.schema.fields.length}`);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
