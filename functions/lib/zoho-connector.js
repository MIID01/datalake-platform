const { AccountingConnector } = require("./accounting-connector");

class ZohoConnector extends AccountingConnector {
  constructor(config) {
    super();
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.refreshToken = config.refreshToken;
    this.orgId = config.orgId;
    this.tokenUrl = "https://accounts.zoho.sa/oauth/v2/token";
    this.apiUrl = "https://www.zohoapis.sa/books/v3";
    this.accessToken = null;
  }

  async init() {
    const params = new URLSearchParams({
      refresh_token: this.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "refresh_token"
    });

    const res = await fetch(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to refresh Zoho token: ${err}`);
    }

    const data = await res.json();
    this.accessToken = data.access_token;
  }

  async _request(endpoint, method = "GET", body = null) {
    if (!this.accessToken) await this.init();

    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `${this.apiUrl}${endpoint}${separator}organization_id=${this.orgId}`;
    console.log(`[ZohoConnector] Requesting: ${url}`);

    const headers = {
      Authorization: `Zoho-oauthtoken ${this.accessToken}`
    };

    const options = { method, headers };
    if (body) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }

    const res = await fetch(url.toString(), options);
    const data = await res.json();

    if (data.code !== 0) {
      throw new Error(`Zoho API Error (${data.code}): ${data.message}`);
    }
    return data;
  }

  async getContacts(filters = {}) {
    const data = await this._request("/contacts");
    return data.contacts.map(c => ({
      zoho_contact_id: c.contact_id,
      name: c.contact_name,
      company_name: c.company_name,
      email: c.email,
      status: c.status
    }));
  }

  async getInvoices(filters = {}) {
    const data = await this._request("/invoices");
    return data.invoices.map(inv => ({
      zoho_invoice_id: inv.invoice_id,
      invoice_number: inv.invoice_number,
      client_name: inv.customer_name,
      status: inv.status.toUpperCase(), // DRAFT, SENT, PAID, OVERDUE, etc.
      total: inv.total,
      balance_due: inv.balance,
      date: inv.date, // YYYY-MM-DD
      due_date: inv.due_date, // YYYY-MM-DD
      currency: inv.currency_code
    }));
  }

  async getPayments(filters = {}) {
    const data = await this._request("/customerpayments");
    return data.customerpayments.map(p => ({
      zoho_payment_id: p.payment_id,
      invoice_ids: p.invoice_numbers, // e.g. "INV-001, INV-002"
      amount: p.amount,
      date: p.date,
      method: p.payment_mode,
      reference: p.reference_number
    }));
  }

  async getExpenses(filters = {}) {
    const data = await this._request("/expenses");
    return data.expenses.map(e => ({
      zoho_expense_id: e.expense_id,
      date: e.date,
      amount: e.total,
      category: e.account_name,
      description: e.description,
      status: e.status
    }));
  }

  // To be fully implemented when creating invoices from platform
  async createInvoice(invoiceData) {
    throw new Error("createInvoice() not yet fully implemented for Phase 1 sync");
  }

  async recordPayment(paymentData) {
    throw new Error("recordPayment() not yet fully implemented for Phase 1 sync");
  }

  async getBankBalance() {
    throw new Error("getBankBalance() not yet fully implemented for Phase 1 sync");
  }
}

module.exports = { ZohoConnector };
