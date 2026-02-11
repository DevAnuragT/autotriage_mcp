/**
 * Retry a function with exponential backoff
 * Handles rate limiting (429) errors from GitHub and Gemini APIs
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      // Check if this is a rate limit error
      const is429 =
        error.status === 429 ||
        error.message?.includes('429') ||
        error.message?.includes('RESOURCE_EXHAUSTED') ||
        error.message?.includes('rate limit');

      // If not a rate limit error or last retry, throw immediately
      if (!is429 || i === maxRetries - 1) {
        throw error;
      }

      // Calculate exponential backoff delay: 1s, 2s, 4s
      const delay = Math.pow(2, i) * 1000;
      console.error(`[WARN] Rate limit hit, retrying in ${delay}ms (attempt ${i + 1}/${maxRetries})`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw new Error('Max retries exceeded');
}
