const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { ZohoConnector } = require('./lib/zoho-connector');
const client = new SecretManagerServiceClient();

async function getSecret(name) {
  const [version] = await client.accessSecretVersion({
    name: `projects/datalake-production-sa/secrets/${name}/versions/latest`,
  });
  return version.payload.data.toString('utf8');
}

async function testZoho() {
  try {
    console.log("Fetching secrets from Secret Manager...");
    const clientId = (await getSecret('zoho-client-id')).trim();
    const clientSecret = (await getSecret('zoho-client-secret')).trim();
    const refreshToken = (await getSecret('zoho-refresh-token')).trim();
    
    console.log("Testing ZohoConnector...");
    const connector = new ZohoConnector({
      clientId,
      clientSecret,
      refreshToken,
      orgId: "150000683960"
    });

    await connector.init();
    console.log("✅ Token refresh successful. Access Token obtained.");
    
    // Test fetching invoices to verify full access scope works
    console.log("Fetching invoices...");
    const invoices = await connector.getInvoices();
    console.log(`✅ Successfully fetched ${invoices.length} invoices!`);
    if (invoices.length > 0) {
      console.log("Sample Invoice:", invoices[0]);
    }
  } catch (err) {
    console.error("❌ Test failed:", err.message);
  }
}

testZoho();
