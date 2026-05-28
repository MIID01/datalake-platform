const admin = require("firebase-admin");
const { notify } = require("./notifications");
const { logToBigQuery } = require("./lib/bigquery");

const db = admin.firestore();

// 1. resetLeaveBalances (Cloud Scheduler: "0 0 1 1 *")
async function resetLeaveBalancesHandler() {
  try {
    const snap = await db.collection("employees").where("employment_status", "==", "active").get();
    
    const batch = db.batch();
    const now = new Date();
    
    for (const doc of snap.docs) {
      const emp = doc.data();
      const current_balance = emp.annual_leave_balance || 0;
      
      let entitlement = 21;
      if (emp.contract_start) {
        const startDate = new Date(emp.contract_start);
        const years = (now - startDate) / (1000 * 60 * 60 * 24 * 365.25);
        if (years >= 5) entitlement = 30;
      }
      
      const max_carry_over = entitlement * 0.5;
      const new_balance = Math.min(current_balance, max_carry_over) + entitlement;
      
      batch.update(doc.ref, {
        annual_leave_balance: new_balance,
        last_leave_reset: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
    if (!snap.empty) {
      await batch.commit();
      console.log(`[HR] Reset leave balances for ${snap.size} employees`);
    }
  } catch (err) {
    console.error("resetLeaveBalances error:", err);
  }
}

// 2. pdplCandidatePurge (Cloud Scheduler: "0 3 * * *")
async function pdplCandidatePurgeHandler() {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    
    const snap = await db.collection("talent_pool")
      .where("status", "==", "REJECTED")
      .where("rejected_at", "<", admin.firestore.Timestamp.fromDate(cutoff))
      .get();
      
    const batch = db.batch();
    
    for (const doc of snap.docs) {
      const candidate = doc.data();
      batch.delete(doc.ref);
      
      // Also delete from GCS if cv_url exists
      if (candidate.cv_url) {
        try {
          // Assuming cv_url is the GCS path or we can extract the filename
          // Just an example, usually requires specific path handling
          const bucket = admin.storage().bucket("datalake-cv-uploads");
          const fileName = candidate.cv_url.split("/").pop(); 
          if (fileName) {
            await bucket.file(fileName).delete({ ignoreNotFound: true });
          }
        } catch (storageErr) {
          console.warn(`Could not delete CV for candidate ${doc.id}:`, storageErr);
        }
      }
      
      await logToBigQuery("datalake_audit", "system_events", {
        event_type: "PDPL_CANDIDATE_PURGE",
        user_id: doc.id,
        details: "Purged rejected candidate older than 30 days",
        timestamp: new Date()
      });
    }
    
    if (!snap.empty) {
      await batch.commit();
      console.log(`[HR] Purged ${snap.size} candidates for PDPL compliance`);
    }
  } catch (err) {
    console.error("pdplCandidatePurge error:", err);
  }
}

// 3. scanContractExpiry (Cloud Scheduler: "0 9 1 * *")
async function scanContractExpiryHandler() {
  try {
    const snap = await db.collection("employees")
      .where("employment_status", "==", "active")
      .where("contract_type", "==", "Limited Contract")
      .get();
      
    const now = new Date();
    const alertThreshold = new Date();
    alertThreshold.setDate(now.getDate() + 60);
    
    let expiringCount = 0;
    
    for (const doc of snap.docs) {
      const emp = doc.data();
      if (!emp.contract_start) continue;
      
      const startDate = new Date(emp.contract_start);
      // Assume 1 year auto-renew if contract_end is not present
      let endDate = emp.contract_end ? new Date(emp.contract_end) : new Date(startDate);
      if (!emp.contract_end) {
        while (endDate <= now) {
          endDate.setFullYear(endDate.getFullYear() + 1);
        }
      }
      
      if (endDate <= alertThreshold && endDate >= now) {
        await notify("ceo", "contract_expiring", { employee_id: emp.employee_id, name: emp.full_name, end_date: endDate.toISOString() });
        await notify("hr", "contract_expiring", { employee_id: emp.employee_id, name: emp.full_name, end_date: endDate.toISOString() });
        expiringCount++;
      }
    }
    console.log(`[HR] Scanned contracts, flagged ${expiringCount} for expiry`);
  } catch (err) {
    console.error("scanContractExpiry error:", err);
  }
}

// 4. validateHireBudget (Firestore Trigger: onDocumentCreated("hire_requests/{docId}"))
async function validateHireBudgetHandler(event) {
  try {
    const hireDoc = event.data;
    if (!hireDoc) return;
    const hire = hireDoc.data();
    
    if (!hire.project_id || !hire.hourly_rate) return;
    
    const projDoc = await db.collection("projects").doc(hire.project_id).get();
    if (!projDoc.exists) return;
    const project = projDoc.data();
    
    // Reads project PO (po_value, po_used, hourly_rate)
    const po_value = project.po_value || 0;
    const po_used = project.po_used || 0;
    const remaining = po_value - po_used;
    
    // Assuming the hire consumes X hours or we just calculate margin based on billing rate vs hourly_rate
    // E.g., project.billing_rate - hire.hourly_rate
    const billing_rate = project.billing_rate || 0;
    let margin = 0;
    
    if (billing_rate > 0) {
      margin = ((billing_rate - hire.hourly_rate) / billing_rate) * 100;
    }
    
    const budget_check = {
      margin_percentage: margin,
      po_remaining: remaining,
      checked_at: new Date().toISOString()
    };
    
    await hireDoc.ref.update({ budget_check });
    
    if (margin < 20) {
      await notify("ceo", "low_margin_hire", { 
        hire_id: event.params.docId, 
        project_id: hire.project_id,
        margin: margin 
      });
    }
  } catch (err) {
    console.error("validateHireBudget error:", err);
  }
}

// 5. gatekeeperMonthlyOpsHandler (Pub/Sub Subscriber to datalake.monthly.trigger)
async function gatekeeperMonthlyOpsHandler(event) {
  console.log("[HR] gatekeeperMonthlyOpsHandler triggered...");
  try {
    await scanContractExpiryHandler();
    await pdplCandidatePurgeHandler();
    console.log("[HR] Gatekeeper monthly ops complete.");
  } catch (err) {
    console.error("gatekeeperMonthlyOpsHandler error:", err);
  }
}

module.exports = {
  resetLeaveBalancesHandler,
  pdplCandidatePurgeHandler,
  scanContractExpiryHandler,
  validateHireBudgetHandler,
  gatekeeperMonthlyOpsHandler
};
