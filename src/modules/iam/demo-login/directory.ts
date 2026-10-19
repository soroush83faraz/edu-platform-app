// «ورود آزمایشی» — the panel's list, read on the SERVER while /login renders (src/app/(auth)/login/page.tsx). Not a
// Server Action and not a route: this module has no "use server", so the browser cannot call it — it only ever
// receives the rendered result, and only when the gate is open (`defineDemoAction`: DEMO_LOGIN=1 + a valid unlock
// cookie, or DEMO_LOGIN_OPEN=1 — then every visitor of /login receives it; NOT_FOUND otherwise, and the page then
// renders no panel at all). One `demoOrgTx` per organization of DEMO_LOGIN_ORGS — the transaction refuses any other —
// so nothing of a real school can reach the list.
import { z } from "zod";
import { defineDemoAction } from "@/lib/actions";
import { buildDemoDirectory, type DemoDirectory, type DemoOrgFacts } from "./labels";
import { findDemoOrgs, listDemoGuardians, listDemoManagerHats, listDemoPeople, listDemoSchools, listDemoStudents, listDemoTeaching } from "./repo";

export const loadDemoDirectory = defineDemoAction({ schema: z.object({}).strict() }, async (_input, tools): Promise<DemoDirectory> => {
  const orgs = await tools.globalTx((tx) => findDemoOrgs(tx, tools.allowedOrgSlugs));
  const facts: DemoOrgFacts[] = [];
  for (const org of orgs) {
    facts.push(
      await tools.demoOrgTx(org.id, async (tx) => ({
        orgId: org.id,
        orgName: org.name,
        schools: await listDemoSchools(tx),
        people: await listDemoPeople(tx),
        managers: await listDemoManagerHats(tx),
        teaching: await listDemoTeaching(tx),
        students: await listDemoStudents(tx),
        guardians: await listDemoGuardians(tx),
      })),
    );
  }
  return buildDemoDirectory(facts);
});
