/**
 * Shared assessment export: ordered question blocks for TXT and Word (.docx).
 */
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type { Assessment, QuestionVariant } from '../types/question';

export type AssessmentExportBlock = {
    order: number;
    stem: string;
    choiceLines: string[];
    answerLine: string | null;
};

/** Slug for download filenames. */
export function slugifyAssessmentBasename(name: string, fallback: string): string {
    const slug = (name || fallback)
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
    return slug || fallback;
}

/**
 * Collects ordered question blocks from section links. When `link.variant` is missing
 * (some API payloads), pass `resolveVariant` from the question bank.
 */
export function collectAssessmentExportBlocks(
    assessment: Assessment,
    resolveVariant?: (variantId: number) => QuestionVariant | undefined
): AssessmentExportBlock[] {
    const aid = assessment.id;
    const blocks: AssessmentExportBlock[] = [];

    (assessment.sections ?? []).forEach((section) => {
        (section.sectionVariants ?? []).forEach((link) => {
            const variant = link.variant ?? resolveVariant?.(link.variantId);
            if (!variant) return;

            const stem =
                variant.questionText?.trim() ||
                variant.questionMetadata?.description?.trim() ||
                '';
            if (!stem) return;

            const choices = variant.choices && Array.isArray(variant.choices) ? variant.choices : [];
            const choiceLines = choices.map((c) => `${c.letter}. ${(c.text || '').trim()}`);
            const rawAnswer = variant.answer?.trim();
            const answerLine = rawAnswer ? `Correct answer: ${rawAnswer}` : null;

            const orderValue =
                link.displayOrder ?? variant.questionMetadata?.questionOrder?.[aid];
            const order = typeof orderValue === 'number' ? orderValue : Number.MAX_SAFE_INTEGER;

            blocks.push({ order, stem, choiceLines, answerLine });
        });
    });

    blocks.sort((a, b) => a.order - b.order);
    return blocks;
}

/** Plain-text export matching the historical TXT download format. */
export function assessmentBlocksToPlainText(blocks: AssessmentExportBlock[]): string {
    return blocks
        .map((b, i) => {
            const parts: string[] = [b.stem, ...b.choiceLines];
            if (b.answerLine) parts.push(b.answerLine);
            return `${i + 1}. ${parts.join('\n')}`;
        })
        .join('\n\n');
}

function stemToParagraphs(stem: string): string[] {
    if (!stem) return [''];
    return stem.split(/\r?\n/);
}

/** Builds a .docx Blob for the assessment title page and numbered questions. */
export async function assessmentBlocksToDocxBlob(
    assessment: Assessment,
    blocks: AssessmentExportBlock[]
): Promise<Blob> {
    const metaParts: string[] = [assessment.type, assessment.semester].filter(Boolean);
    if (assessment.course?.name) {
        metaParts.push(assessment.course.name);
    }
    const metaLine = metaParts.join(' · ');

    const children: Paragraph[] = [
        new Paragraph({
            text: assessment.name,
            heading: HeadingLevel.TITLE,
            spacing: { after: 120 }
        }),
        new Paragraph({
            children: [new TextRun({ text: metaLine, italics: true })],
            spacing: { after: 240 }
        })
    ];

    blocks.forEach((b, i) => {
        const n = i + 1;
        const stemLines = stemToParagraphs(b.stem);
        const [firstStem, ...restStem] = stemLines.length ? stemLines : [''];

        children.push(
            new Paragraph({
                children: [
                    new TextRun({ text: `${n}. `, bold: true }),
                    new TextRun({ text: firstStem ?? '' })
                ],
                spacing: { before: 200, after: 80 }
            })
        );
        restStem.forEach((line) => {
            children.push(new Paragraph({ text: line, spacing: { after: 80 } }));
        });

        b.choiceLines.forEach((line) => {
            children.push(new Paragraph({ text: line, spacing: { after: 40 } }));
        });

        if (b.answerLine) {
            children.push(
                new Paragraph({
                    children: [new TextRun({ text: b.answerLine, italics: true })],
                    spacing: { after: 120 }
                })
            );
        }
    });

    const doc = new Document({
        sections: [
            {
                children
            }
        ]
    });

    return Packer.toBlob(doc);
}
