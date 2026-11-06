// The term rules live in @triton/shared: the server's calendar feed names each term's calendar with them.
export {
  type TermKey, type Season, type SwitcherCell, type SwitcherRows,
  termKey, seasonOf, periodOf, SEASON_NAMES, calendarYear, displayYear, displayTermLabel, chronoIndex,
  archiveBoundary, isArchived, termOf, liveUpcomingTerm, layoutRows, buildSwitcherRows,
} from '@triton/shared';
