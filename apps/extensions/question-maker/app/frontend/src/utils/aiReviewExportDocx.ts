/**
 * AI variant review report as a real Word Open XML (.docx) document.
 */
import {
    Document,
    HeadingLevel,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType
} from 'docx';
import type { VariantAiReviewResult } from '../services/assessmentVariantService';

function formatUsabilityLabel(value: string): string {
    if (value === 'usable_as_is') return 'Usable as-is';
    if (value === 'usable_with_edits') return 'Usable with edits';
    if (value === 'unusable') return 'Unusable';
    return value.replaceAll('_', ' ');
}

function scoreOfRow(r: VariantAiReviewResult['perQuestion'][number]): number {
    if (
        typeof r.exam_variant_composite_score_1to5 === 'number' &&
        Number.isFinite(r.exam_variant_composite_score_1to5)
    ) {
        const distinctnessFactor =
            typeof r.exam_variant_distinctness_factor === 'number' && Number.isFinite(r.exam_variant_distinctness_factor)
                ? r.exam_variant_distinctness_factor
                : 1;
        const usabilityAdjusted =
            typeof r.exam_variant_composite_score_1to5_usability_adjusted === 'number' &&
            Number.isFinite(r.exam_variant_composite_score_1to5_usability_adjusted)
                ? r.exam_variant_composite_score_1to5_usability_adjusted
                : r.exam_variant_composite_score_1to5;
        return usabilityAdjusted * distinctnessFactor;
    }
    const vals = [
        r.conceptual_equivalence,
        r.difficulty_similarity,
        r.structural_validity,
        r.answer_correctness,
        r.topic_alignment
    ].filter((v): v is number => typeof v === 'number');
    if (vals.length === 0) return 0;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function cellParagraph(text: string, header = false): Paragraph {
    return new Paragraph({
        children: [new TextRun({ text, bold: header })],
        spacing: { after: 40 }
    });
}

/** Builds a .docx matching the former HTML report sections. */
export async function buildAiReviewDocxBlob(
    result: VariantAiReviewResult,
    baselineName: string,
    variantName: string
): Promise<Blob> {
    const rows = [...result.perQuestion];
    const ranked = rows.map((r) => ({ row: r, avg: scoreOfRow(r) })).sort((a, b) => b.avg - a.avg);
    const highExamples = ranked.slice(0, Math.min(3, ranked.length));
    const lowExample = ranked.length > 0 ? ranked[ranked.length - 1] : null;

    const avg = (k: string) => {
        const v = result.averages[k];
        return typeof v === 'number' ? v.toFixed(2) : 'n/a';
    };

    const finalScore0to100 =
        typeof result.examVariantScoreFinal0to100 === 'number' ? result.examVariantScoreFinal0to100 : null;
    const baseScore0to100 =
        typeof result.examVariantScoreBase0to100 === 'number' ? result.examVariantScoreBase0to100 : null;
    const usablePct =
        typeof result.usableQuestionPercentage === 'number' ? result.usableQuestionPercentage : null;
    const reviewSeconds = typeof result.reviewTimeMs === 'number' ? result.reviewTimeMs / 1000 : null;
    const distinctnessAvg =
        typeof result.distinctnessAverage1to5 === 'number' ? result.distinctnessAverage1to5 : null;
    const distinctnessFactorAvg =
        typeof result.distinctnessFactorAvg === 'number' ? result.distinctnessFactorAvg : null;
    const overallSummaryText = result.overallSummary?.summaryText ?? 'n/a';
    const overallStrengthsText = Array.isArray(result.overallSummary?.strengths)
        ? result.overallSummary.strengths.join(', ')
        : 'n/a';
    const overallWeaknessesText = Array.isArray(result.overallSummary?.weaknesses)
        ? result.overallSummary.weaknesses.join(', ')
        : 'n/a';
    const totalScoreCalcSummary = result.totalScoreCalculationSummary ?? null;

    const headerCells = [
        'Slot',
        'Concept',
        'Difficulty',
        'Structure',
        'Answer',
        'Topic',
        'Distinctness',
        'Usability',
        'Reason'
    ].map((h) => new TableCell({ children: [cellParagraph(h, true)] }));

    const dataRows = rows.map(
        (r) =>
            new TableRow({
                children: [
                    new TableCell({ children: [cellParagraph(String(r.slot))] }),
                    new TableCell({
                        children: [cellParagraph(r.conceptual_equivalence != null ? String(r.conceptual_equivalence) : '-')]
                    }),
                    new TableCell({
                        children: [cellParagraph(r.difficulty_similarity != null ? String(r.difficulty_similarity) : '-')]
                    }),
                    new TableCell({
                        children: [cellParagraph(r.structural_validity != null ? String(r.structural_validity) : '-')]
                    }),
                    new TableCell({
                        children: [cellParagraph(r.answer_correctness != null ? String(r.answer_correctness) : '-')]
                    }),
                    new TableCell({
                        children: [cellParagraph(r.topic_alignment != null ? String(r.topic_alignment) : '-')]
                    }),
                    new TableCell({ children: [cellParagraph(r.distinctness != null ? String(r.distinctness) : '-')] }),
                    new TableCell({ children: [cellParagraph(formatUsabilityLabel(r.usability))] }),
                    new TableCell({ children: [cellParagraph(r.brief_reason ?? '')] })
                ]
            })
    );

    const table = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [new TableRow({ children: headerCells }), ...dataRows]
    });

    const rubricLines = (result.rubricUsed || '(none)').split(/\r?\n/);

    const children: Paragraph[] = [
        new Paragraph({
            text: 'AI Judge Report',
            heading: HeadingLevel.TITLE,
            spacing: { after: 200 }
        }),
        new Paragraph({
            children: [
                new TextRun({ text: 'Baseline exam: ', bold: true }),
                new TextRun({ text: `${baselineName} (#${result.baselineAssessmentId})` })
            ],
            spacing: { after: 80 }
        }),
        new Paragraph({
            children: [
                new TextRun({ text: 'Variant exam: ', bold: true }),
                new TextRun({ text: `${variantName} (#${result.variantAssessmentId})` })
            ],
            spacing: { after: 80 }
        }),
        new Paragraph({
            children: [
                new TextRun({ text: 'Model: ', bold: true }),
                new TextRun({ text: result.model })
            ],
            spacing: { after: 80 }
        }),
        new Paragraph({
            children: [
                new TextRun({ text: 'Compared slots: ', bold: true }),
                new TextRun({ text: String(result.comparedSlots) })
            ],
            spacing: { after: 80 }
        }),
        new Paragraph({
            children: [
                new TextRun({ text: 'Review time: ', bold: true }),
                new TextRun({ text: reviewSeconds != null ? `${reviewSeconds.toFixed(1)}s` : 'n/a' })
            ],
            spacing: { after: 240 }
        }),

        new Paragraph({ text: 'Overall score', heading: HeadingLevel.HEADING_2, spacing: { before: 120, after: 120 } }),
        new Paragraph({
            children: [
                new TextRun({ text: 'Final exam variant score: ', bold: true }),
                new TextRun({
                    text: `${finalScore0to100 != null ? finalScore0to100.toFixed(0) : 'n/a'} / 100`
                })
            ],
            spacing: { after: 80 }
        }),
        new Paragraph({
            children: [
                new TextRun({ text: 'Base (rubric-only): ', bold: true }),
                new TextRun({ text: `${baseScore0to100 != null ? baseScore0to100.toFixed(0) : 'n/a'} / 100` })
            ],
            spacing: { after: 80 }
        }),
        new Paragraph({
            children: [
                new TextRun({ text: 'Usable questions: ', bold: true }),
                new TextRun({ text: `${usablePct != null ? usablePct.toFixed(0) : 'n/a'}%` })
            ],
            spacing: { after: 80 }
        }),
        new Paragraph({
            children: [
                new TextRun({ text: 'Distinctness: ', bold: true }),
                new TextRun({
                    text: `${distinctnessAvg != null ? distinctnessAvg.toFixed(2) : 'n/a'}/5 (factor ${distinctnessFactorAvg != null ? distinctnessFactorAvg.toFixed(2) : 'n/a'})`
                })
            ],
            spacing: { after: 80 }
        })
    ];

    if (totalScoreCalcSummary) {
        children.push(
            new Paragraph({
                children: [new TextRun({ text: `Total score calculation: ${totalScoreCalcSummary}`, italics: true })],
                spacing: { after: 240 }
            })
        );
    } else {
        children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
    }

    children.push(
        new Paragraph({ text: 'Instructor summary', heading: HeadingLevel.HEADING_2, spacing: { before: 120, after: 120 } }),
        new Paragraph({
            children: [
                new TextRun({ text: 'Summary: ', bold: true }),
                new TextRun({ text: overallSummaryText })
            ],
            spacing: { after: 100 }
        }),
        new Paragraph({
            children: [
                new TextRun({ text: 'Strengths: ', bold: true }),
                new TextRun({ text: overallStrengthsText })
            ],
            spacing: { after: 100 }
        }),
        new Paragraph({
            children: [
                new TextRun({ text: 'Weaknesses: ', bold: true }),
                new TextRun({ text: overallWeaknessesText })
            ],
            spacing: { after: 240 }
        }),

        new Paragraph({ text: 'Aggregate scores', heading: HeadingLevel.HEADING_2, spacing: { before: 120, after: 120 } }),
        new Paragraph({
            text: `Conceptual equivalence: ${avg('conceptual_equivalence')}`,
            spacing: { after: 60 }
        }),
        new Paragraph({
            text: `Difficulty similarity: ${avg('difficulty_similarity')}`,
            spacing: { after: 60 }
        }),
        new Paragraph({
            text: `Structural validity: ${avg('structural_validity')}`,
            spacing: { after: 60 }
        }),
        new Paragraph({
            text: `Answer correctness: ${avg('answer_correctness')}`,
            spacing: { after: 60 }
        }),
        new Paragraph({
            text: `Topic alignment: ${avg('topic_alignment')}`,
            spacing: { after: 240 }
        }),

        new Paragraph({ text: 'Usability', heading: HeadingLevel.HEADING_2, spacing: { before: 120, after: 120 } }),
        new Paragraph({
            text: `Usable as-is: ${result.usabilityCounts.usable_as_is}`,
            spacing: { after: 60 }
        }),
        new Paragraph({
            text: `Usable with edits: ${result.usabilityCounts.usable_with_edits}`,
            spacing: { after: 60 }
        }),
        new Paragraph({
            text: `Unusable: ${result.usabilityCounts.unusable}`,
            spacing: { after: 240 }
        }),

        new Paragraph({
            text: 'Qualitative examples',
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 120, after: 120 }
        }),
        new Paragraph({
            text: 'Highest-rated variants (2–3 examples)',
            heading: HeadingLevel.HEADING_3,
            spacing: { after: 80 }
        })
    );

    if (highExamples.length === 0) {
        children.push(new Paragraph({ text: 'n/a', spacing: { after: 120 } }));
    } else {
        highExamples.forEach((item, idx) => {
            children.push(
                new Paragraph({
                    text: `${idx + 1}. Slot ${item.row.slot} (composite ${item.avg.toFixed(2)}/5) — ${formatUsabilityLabel(item.row.usability)}: ${item.row.brief_reason ?? ''}`,
                    spacing: { after: 80 }
                })
            );
        });
    }

    children.push(
        new Paragraph({
            text: 'Low-rated variant (1 example)',
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 120, after: 80 }
        }),
        new Paragraph({
            text: lowExample
                ? `Slot ${lowExample.row.slot} (composite ${lowExample.avg.toFixed(2)}/5) — ${formatUsabilityLabel(lowExample.row.usability)}: ${lowExample.row.brief_reason ?? ''}`
                : 'n/a',
            spacing: { after: 240 }
        }),
        new Paragraph({
            text: 'Per-slot results',
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 120, after: 120 }
        })
    );

    const rubricHeading = new Paragraph({
        text: 'Rubric used',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 120 }
    });
    const rubricParagraphs = rubricLines.map(
        (line) =>
            new Paragraph({
                text: line,
                spacing: { after: 40 }
            })
    );
    const footerPara = new Paragraph({
        children: [
            new TextRun({
                text: 'Generated by Assessment Variant Workflow — AI Review export.',
                italics: true
            })
        ],
        spacing: { before: 200 }
    });

    const doc = new Document({
        sections: [
            {
                children: [...children, table, rubricHeading, ...rubricParagraphs, footerPara]
            }
        ]
    });

    return Packer.toBlob(doc);
}
