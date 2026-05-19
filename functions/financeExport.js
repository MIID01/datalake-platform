const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { BigQuery } = require("@google-cloud/bigquery");

const _bq = new BigQuery({ projectId: "datalake-production-sa" });
const FINANCE_DATASET = "datalake_finance";
const INVOICES_TABLE = "invoices";
const EXPENSES_TABLE = "expenses";

async function ensureFinanceDataset() {
  const dataset = _bq.dataset(FINANCE_DATASET);
  const [exists] = await dataset.exists();
  if (!exists) {
    await dataset.create({ location: "me-central2" });
    console.log(`[BQ] Created dataset ${FINANCE_DATASET}`);
  }
  return dataset;
}

async function ensureTable(dataset, tableName, schema) {
  const table = dataset.table(tableName);
  const [exists] = await table.exists();
  if (!exists) {
    await dataset.createTable(tableName, {
      schema,
      timePartitioning: { type: "DAY", field: "created_at" },
    });
    console.log(`[BQ] Created table ${FINANCE_DATASET}.${tableName}`);
  }
}

exports.exportInvoiceToBQ = onDocumentWritten(
  { document: "invoices/{invoiceId}", region: "me-central2", memory: "256MiB" },
  async (event) => {
    const snap = event.data.after;
    if (!snap.exists) return; // Ignore deletes for now or handle accordingly

    const data = snap.data();
    try {
      const dataset = await ensureFinanceDataset();
      await ensureTable(dataset, INVOICES_TABLE, [
        { name: "invoice_id", type: "STRING", mode: "REQUIRED" },
        { name: "client_name", type: "STRING", mode: "NULLABLE" },
        { name: "project_id", type: "STRING", mode: "NULLABLE" },
        { name: "total", type: "FLOAT", mode: "NULLABLE" },
        { name: "status", type: "STRING", mode: "NULLABLE" },
        { name: "created_at", type: "TIMESTAMP", mode: "REQUIRED" },
        { name: "due_date", type: "STRING", mode: "NULLABLE" },
      ]);

      const createdDate = data.created_at?.toDate ? data.created_at.toDate() : new Date(data.created_at || Date.now());

      await dataset.table(INVOICES_TABLE).insert([{
        invoice_id: snap.id,
        client_name: data.client_name || data.client || null,
        project_id: data.project_id || null,
        total: data.total || data.amount || 0,
        status: data.status || "DRAFT",
        created_at: _bq.timestamp(createdDate),
        due_date: data.due_date || data.dueDate || null,
      }]);
    } catch (err) {
      console.error("[BQ] Failed to export invoice:", err.message);
    }
  }
);

exports.exportExpenseToBQ = onDocumentWritten(
  { document: "expenses/{expenseId}", region: "me-central2", memory: "256MiB" },
  async (event) => {
    const snap = event.data.after;
    if (!snap.exists) return;

    const data = snap.data();
    try {
      const dataset = await ensureFinanceDataset();
      await ensureTable(dataset, EXPENSES_TABLE, [
        { name: "expense_id", type: "STRING", mode: "REQUIRED" },
        { name: "engineer_id", type: "STRING", mode: "NULLABLE" },
        { name: "category", type: "STRING", mode: "NULLABLE" },
        { name: "amount", type: "FLOAT", mode: "NULLABLE" },
        { name: "status", type: "STRING", mode: "NULLABLE" },
        { name: "created_at", type: "TIMESTAMP", mode: "REQUIRED" },
      ]);

      const createdDate = data.created_at?.toDate ? data.created_at.toDate() : new Date(data.created_at || Date.now());

      await dataset.table(EXPENSES_TABLE).insert([{
        expense_id: snap.id,
        engineer_id: data.engineer_id || null,
        category: data.category || "Other",
        amount: Number(data.amount) || 0,
        status: data.status || "SUBMITTED",
        created_at: _bq.timestamp(createdDate),
      }]);
    } catch (err) {
      console.error("[BQ] Failed to export expense:", err.message);
    }
  }
);
