import { z } from 'zod';

export interface RmpTeacher {
  legacyId: number;
  firstName: string;
  lastName: string;
  department: string | null;
  avgRating: number | null;
  numRatings: number;
}

const URL_ = 'https://www.ratemyprofessors.com/graphql';
const MAX_PAGES = 10;
const QUERY =
  'query T($count:Int!,$cursor:String,$query:TeacherSearchQuery!){search:newSearch{teachers(query:$query,first:$count,after:$cursor){edges{node{legacyId firstName lastName department avgRating numRatings}}pageInfo{hasNextPage endCursor}}}}';

const page = z.object({
  data: z.object({
    search: z.object({
      teachers: z.object({
        edges: z.array(
          z.object({
            node: z.object({
              legacyId: z.number().int(),
              firstName: z.string(),
              lastName: z.string(),
              department: z.string().nullable(),
              avgRating: z.number().nullable(),
              numRatings: z.number().int(),
            }),
          }),
        ),
        pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
      }),
    }),
  }),
});

/**
 * The whole UCSD roster, or a throw. A short or malformed page never yields a partial list: the caller replaces
 * the stored snapshot wholesale, so half a roster would silently turn real matches into "no match".
 * Error messages carry no response body.
 */
export async function fetchAllTeachers(fetchFn: typeof fetch): Promise<RmpTeacher[]> {
  const out: RmpTeacher[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const res = await fetchFn(URL_, {
      method: 'POST',
      headers: {
        Authorization: 'Basic dGVzdDp0ZXN0',
        'Content-Type': 'application/json',
        'User-Agent': 'TritonPlan/2.0 (+https://tritonplan.cn)',
      },
      body: JSON.stringify({
        query: QUERY,
        variables: { count: 1000, cursor, query: { text: '', schoolID: 'U2Nob29sLTEwNzk=', fallback: false } },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`RMP responded ${res.status}`);
    }
    const parsed = page.safeParse(await res.json());
    if (!parsed.success) throw new Error('RMP response had an unexpected shape');
    const { edges, pageInfo } = parsed.data.data.search.teachers;
    for (const { node } of edges) out.push(node);
    if (!pageInfo.hasNextPage) return out;
    if (!pageInfo.endCursor) throw new Error('RMP page has more results but no cursor');
    cursor = pageInfo.endCursor;
  }
  throw new Error(`RMP roster is longer than ${MAX_PAGES} pages`);
}
