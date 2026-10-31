/** One RateMyProfessors lookup result. `match` is null unless exactly one UCSD professor has this exact name. */
export interface RmpLookup {
  name: string;
  match: {
    legacyId: number;
    firstName: string;
    lastName: string;
    department: string | null;
    avgRating: number | null;
    numRatings: number;
    url: string;
  } | null;
  /** Always set, so the client can fall back to RMP's own search when there is no safe match. */
  searchUrl: string;
}
