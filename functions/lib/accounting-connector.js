/**
 * Base Interface for Accounting Connectors
 * DTLK-PROMPT-FIN-001 Architecture
 */
class AccountingConnector {
  /**
   * Initializes the connector (e.g. fetches auth tokens)
   */
  async init() {
    throw new Error("init() must be implemented by subclass");
  }

  /**
   * Fetches invoices from the external system
   * @param {Object} filters
   * @returns {Promise<Array>} Array of normalized invoice objects
   */
  async getInvoices(filters = {}) {
    throw new Error("getInvoices() must be implemented by subclass");
  }

  /**
   * Pushes a platform invoice to the external system
   * @param {Object} invoiceData Platform-native invoice data
   * @returns {Promise<String>} External ID of the created invoice
   */
  async createInvoice(invoiceData) {
    throw new Error("createInvoice() must be implemented by subclass");
  }

  /**
   * Fetches payments from the external system
   * @param {Object} filters
   * @returns {Promise<Array>} Array of normalized payment objects
   */
  async getPayments(filters = {}) {
    throw new Error("getPayments() must be implemented by subclass");
  }

  /**
   * Pushes a platform payment to the external system
   * @param {Object} paymentData
   */
  async recordPayment(paymentData) {
    throw new Error("recordPayment() must be implemented by subclass");
  }

  /**
   * Fetches contacts/clients from the external system
   * @param {Object} filters
   * @returns {Promise<Array>} Array of normalized contact objects
   */
  async getContacts(filters = {}) {
    throw new Error("getContacts() must be implemented by subclass");
  }

  /**
   * Fetches expenses from the external system
   * @param {Object} filters
   * @returns {Promise<Array>} Array of normalized expense objects
   */
  async getExpenses(filters = {}) {
    throw new Error("getExpenses() must be implemented by subclass");
  }

  /**
   * Fetches bank balances
   */
  async getBankBalance() {
    throw new Error("getBankBalance() must be implemented by subclass");
  }
}

module.exports = { AccountingConnector };
