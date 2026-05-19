const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { ZohoConnector } = require("./lib/zoho-connector");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// Define secrets from Google Cloud Secret Manager
const zohoClientId = defineSecret("zoho-client-id");
const zohoClientSecret = defineSecret("zoho-client-secret");
const zohoRefreshToken = defineSecret("zoho-refresh-token");

/**
 * syncZohoFinance
 * Hourly cron job to sync external accounting data (Zoho Books) into the platform.
 * DTLK-PROMPT-FIN-001: Uses the Accounting Connector interface.
 */
exports.syncZohoFinance = onSchedule({
  schedule: "0 * * * *", // Every hour
  region: "me-central2",
  timeoutSeconds: 300,
  memory: "512MiB",
  secrets: [zohoClientId, zohoClientSecret, zohoRefreshToken],
}, async (event) => {
  console.log("Starting Accounting Sync (Zoho Books)...");

  try {
    const config = {
      clientId: zohoClientId.value().trim(),
      clientSecret: zohoClientSecret.value().trim(),
      refreshToken: zohoRefreshToken.value().trim(),
      orgId: "150000683960",
    };

    const connector = new ZohoConnector(config);
    // Init fetches the token implicitly on first request, but we can call it explicitly to test
    await connector.init();
    console.log("Successfully authenticated with Zoho API.");

    const batch = db.batch();

    // 1. Sync Contacts (Clients)
    console.log("Fetching Contacts...");
    const contacts = await connector.getContacts();
    contacts.forEach((contact) => {
      // Use zoho_contact_id as document ID for mapping, or query by name.
      // For platform native, we'll store them in 'clients' collection with Zoho reference.
      const ref = db.collection("clients").doc(contact.zoho_contact_id);
      batch.set(ref, {
        ...contact,
        synced_to_accounting: true,
        last_synced_at: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });

    // 2. Sync Invoices
    console.log("Fetching Invoices...");
    const invoices = await connector.getInvoices();
    invoices.forEach((inv) => {
      const ref = db.collection("invoices").doc(inv.zoho_invoice_id);
      // Ensure dates are Firestore Timestamps where possible, or keep as string for now if frontend parses it
      // The frontend uses `created_at` instead of `date` for the invoice date, and `client_name` for customer.
      batch.set(ref, {
        invoice_number: inv.invoice_number,
        client_name: inv.client_name,
        status: inv.status,
        total: inv.total,
        balance_due: inv.balance_due,
        created_at: inv.date, // Mapping to platform native
        due_date: inv.due_date,
        currency: inv.currency,
        zoho_invoice_id: inv.zoho_invoice_id,
        synced_to_accounting: true,
        last_synced_at: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });

    // 3. Sync Payments
    console.log("Fetching Payments...");
    const payments = await connector.getPayments();
    payments.forEach((payment) => {
      const ref = db.collection("payments").doc(payment.zoho_payment_id);
      batch.set(ref, {
        ...payment,
        synced_to_accounting: true,
        last_synced_at: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });

    // 4. Sync Expenses
    console.log("Fetching Expenses...");
    const expenses = await connector.getExpenses();
    expenses.forEach((expense) => {
      const ref = db.collection("expenses").doc(expense.zoho_expense_id);
      batch.set(ref, {
        ...expense,
        synced_to_accounting: true,
        last_synced_at: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });

    // Commit all writes to Firestore
    await batch.commit();
    console.log("Accounting Sync completed successfully.");

  } catch (error) {
    console.error("Accounting Sync Failed:", error.message);
  }
});
