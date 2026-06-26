/** exomind stats — 知识库统计。 */
import type { ApiClient } from '../api';
import { output, cyan, dim } from '../format';

export default async function stats(client: ApiClient): Promise<void> {
  const result = await client.get('/stats');
  output(result, () => {
    for (const [k, v] of Object.entries(result)) {
      if (v && typeof v === 'object') {
        console.log(`${cyan(k)}:`);
        for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
          console.log(`  ${dim(`${k2}:`)} ${Array.isArray(v2) ? v2.length : v2}`);
        }
      } else {
        console.log(`${dim(`${k}:`)} ${v}`);
      }
    }
  });
}
