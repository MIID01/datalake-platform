const admin = require("firebase-admin");

// Initialize Firebase Admin (assuming default credentials via GOOGLE_APPLICATION_CREDENTIALS)
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

async function seedDatalakeTenant() {
  const tenantId = "datalake";
  
  const brandingData = {
    company_name: "Datalake Saudi Arabia LLC",
    company_name_ar: "شركة بحيرة البيانات للاستشارات في مجال الاتصالات وتقنية المعلومات",
    cr_number: "1009194773",
    nun_number: "7048904952",
    vat_number: "",
    address: "Rajiyah Street, Al Yarmuk District, Riyadh 13243",
    address_ar: "شارع راجية، حي اليرموك، الرياض 13243",
    country: "Kingdom of Saudi Arabia",
    
    primary_color: "#022873",
    secondary_color: "#1598CC",
    accent_color: "#EF5829",
    success_color: "#34BF3A",
    
    heading_font: "Helvetica-Bold",
    body_font: "Helvetica",
    
    logo_url: "gs://datalake-grc-library/brand/logo.png",
    stamp_url: "gs://datalake-grc-library/brand/company-stamp.png",
    favicon_url: "",
    
    footer_text: "Datalake Saudi Arabia LLC · Rajiyah Street, Al Yarmuk District, Riyadh 13243, Kingdom of Saudi Arabia · CR 1009194773 · Unified Number 7048904952",
    invoice_terms: "Payment due within 30 days",
    invoice_bank_name: "Al Rajhi Bank",
    invoice_iban: "SA...",
    
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_by: "m.alqumri@datalake.sa"
  };

  try {
    await db.collection("tenants").doc(tenantId).collection("branding").doc("config").set(brandingData);
    console.log("Successfully seeded Datalake tenant branding!");
  } catch (error) {
    console.error("Error seeding branding:", error);
  }
}

seedDatalakeTenant().then(() => process.exit(0));
