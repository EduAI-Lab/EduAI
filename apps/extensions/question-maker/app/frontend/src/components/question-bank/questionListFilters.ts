/**
 * Shared glue between the question filter toolbar and the list surfaces (#1762).
 * Filtering, sorting and paging are server-side; `variantMatchesFilters` only hides
 * the variants of a server-matched question that fail variant-level filters, so a
 * card-per-variant list doesn't show a medium variant under a "hard" filter.
 * Mirrors backend/src/utils/questionListQuery.js.
 */
import type { QuestionBank } from "@/services/questionBankService";
import type { QuestionVariantEntry } from "@/types/question";
import type { BankOption, QuestionFilters, QuestionSort } from "./QuestionFilterToolbar";

export function toQuestionListOptions(
  filters: QuestionFilters,
  search: string,
  sortBy: QuestionSort,
) {
  return {
    search: search || undefined,
    types: filters.questionTypes,
    difficulties: filters.difficulties,
    reasoningLevels: filters.reasoningLevels,
    aiGenerated: filters.aiGenerated,
    draftStatus: filters.draftStatus,
    sortBy,
    questionBankId: filters.questionBankId ?? undefined,
  };
}

export function variantMatchesFilters(
  entry: QuestionVariantEntry,
  searchTerm: string,
  filters: QuestionFilters,
): boolean {
  const { variant } = entry;
  const term = searchTerm.trim().toLowerCase();
  if (
    term &&
    !entry.questionDescription?.toLowerCase().includes(term) &&
    !variant.questionText.toLowerCase().includes(term)
  ) {
    return false;
  }
  if (filters.difficulties.length > 0 && !filters.difficulties.includes(variant.difficulty)) {
    return false;
  }
  if (
    filters.reasoningLevels.length > 0 &&
    !(variant.reasoningLevel && filters.reasoningLevels.includes(variant.reasoningLevel))
  ) {
    return false;
  }
  if (
    filters.aiGenerated !== "all" &&
    (entry.isAiGenerated === true) !== (filters.aiGenerated === "ai")
  ) {
    return false;
  }
  if (
    filters.draftStatus !== "all" &&
    (entry.isDraft === true) !== (filters.draftStatus === "draft")
  ) {
    return false;
  }
  return true;
}

export function toBankOptions(banks: QuestionBank[]): BankOption[] {
  return banks.map((bank) => ({ value: bank.id, label: bank.name, isDefault: bank.isDefault }));
}
