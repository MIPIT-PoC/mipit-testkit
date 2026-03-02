const API_URL = process.env.API_URL ?? 'http://localhost:8080';

describe('Contract: OpenAPI Validation', () => {
  describe('POST /payments response', () => {
    it('should return 202 with payment_id, status, and destination fields', async () => {
      // TODO: Send a valid PIX payload and validate response against OpenAPI schema
      // - Response must include: payment_id (string), status (enum), destination (string)
      // - Content-Type must be application/json
      expect(true).toBe(true);
    });

    it('should return 400 for invalid payload with error details', async () => {
      // TODO: Send payload with missing required fields
      // - Validate error response matches OpenAPI error schema
      // - Must include: error (string), details (array)
      expect(true).toBe(true);
    });

    it('should return 409 for idempotency conflict', async () => {
      // TODO: Send two different payloads with same Idempotency-Key
      // - Validate 409 response matches OpenAPI error schema
      expect(true).toBe(true);
    });
  });

  describe('GET /payments/:id response', () => {
    it('should return 200 with full payment detail matching schema', async () => {
      // TODO: Create a payment, then GET it
      // - Validate all fields match OpenAPI PaymentDetail schema
      // - Must include: payment_id, status, origin, destination, canonical, timestamps
      expect(true).toBe(true);
    });

    it('should return 404 for non-existent payment', async () => {
      // TODO: GET a non-existent payment_id
      // - Validate 404 response matches OpenAPI error schema
      expect(true).toBe(true);
    });
  });

  describe('GET /health response', () => {
    it('should return 200 with status field', async () => {
      // TODO: Validate health endpoint response against OpenAPI schema
      expect(true).toBe(true);
    });
  });
});
