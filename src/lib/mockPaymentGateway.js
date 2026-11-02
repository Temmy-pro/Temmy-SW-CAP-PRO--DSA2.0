export async function charge({ decline = false } = {}) {
  return { status: decline ? 'declined' : 'success' };
}

export const mockPaymentGateway = Object.freeze({ charge });
