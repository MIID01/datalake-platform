const { BigQuery } = require("@google-cloud/bigquery");

// Initialize BigQuery client
const bigquery = new BigQuery();

/**
 * Helper to log data to BigQuery.
 * Automatically creates the dataset and table if they don't exist.
 * 
 * @param {string} datasetId - The BigQuery dataset ID (e.g., "datalake_audit")
 * @param {string} tableId - The BigQuery table ID (e.g., "ai_actions")
 * @param {object} payload - The JSON payload to insert
 */
async function logToBigQuery(datasetId, tableId, payload) {
  try {
    const dataset = bigquery.dataset(datasetId);
    
    // Ensure dataset exists
    const [datasetExists] = await dataset.exists();
    if (!datasetExists) {
      console.log(`[BigQuery] Creating dataset: ${datasetId}`);
      await bigquery.createDataset(datasetId, { location: "me-central2" });
    }

    const table = dataset.table(tableId);

    // To utilize schema auto-detection we can just use the insert method.
    // However, the Node.js client's insert() requires the table to exist.
    // Let's ensure the table exists or create it dynamically based on payload keys.
    const [tableExists] = await table.exists();
    if (!tableExists) {
      console.log(`[BigQuery] Creating table: ${tableId} in dataset: ${datasetId}`);
      
      // Auto-generate schema based on payload keys (simple detection)
      const schema = Object.keys(payload).map(key => {
        let type = 'STRING';
        if (typeof payload[key] === 'number') type = 'NUMERIC';
        if (typeof payload[key] === 'boolean') type = 'BOOLEAN';
        if (payload[key] instanceof Date) type = 'TIMESTAMP';
        // For complex nested objects, we'll store them as JSON strings for simplicity in audit logs
        return { name: key, type: type };
      });

      await dataset.createTable(tableId, { schema });
    }

    // Process payload to ensure nested objects are stringified for STRING columns
    // (since our simple schema auto-detection treats unknown/objects as STRING)
    const processedPayload = { ...payload };
    for (const key in processedPayload) {
      if (typeof processedPayload[key] === 'object' && !(processedPayload[key] instanceof Date) && processedPayload[key] !== null) {
        processedPayload[key] = JSON.stringify(processedPayload[key]);
      }
    }

    // Insert data
    await table.insert([processedPayload]);
  } catch (error) {
    console.error(`[BigQuery] Failed to log to ${datasetId}.${tableId}:`, error);
    // We don't want audit log failures to crash the main transaction
  }
}

module.exports = {
  logToBigQuery
};
