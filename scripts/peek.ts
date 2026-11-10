/** Studio Job 응답 구조 확인용: npx tsx scripts/peek.ts <job_id> */
import "dotenv/config";
import { StudioClient } from "@/lib/studio/client";

(async () => {
  const r = (await new StudioClient().getResponse(process.argv[2], "all")) as unknown as Record<string, unknown> & { output?: Array<Record<string, unknown>> };
  const out = {
    ...r,
    output: r.output?.map((x) => {
      const c0 = (x.content as Array<Record<string, unknown>> | undefined)?.[0];
      return { step_type: x.step_type, keys: Object.keys(x), c0keys: Object.keys(c0 ?? {}), av: JSON.stringify(c0?.additional_values).slice(0, 500), usage: x.usage };
    }),
  };
  console.log(JSON.stringify(out, null, 1).slice(0, 5000));
})();
