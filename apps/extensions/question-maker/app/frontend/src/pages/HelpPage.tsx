/**
 * Help center for Question Maker. Presents the user guide as searchable accordion
 * sections, plus a guided-tour relaunch and a keyboard-shortcuts reference.
 */
import { type ReactNode, useMemo, useState } from 'react';
import {
    IconKeyboard,
    IconRoute,
    IconSearch,
} from '@tabler/icons-react';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
    Badge,
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    Input,
    PageHeading,
} from '@eduai/ui';
import { useGuidedTour } from '../contexts/GuidedTourContext';

interface HelpArticle {
    id: string;
    title: string;
    /** Lowercased keywords for the search filter. */
    keywords: string;
    body: ReactNode;
}

const SHORTCUTS: { keys: string; label: string }[] = [
    { keys: '⌘K / Ctrl+K', label: 'Open command palette' },
    { keys: '⌘Enter', label: 'Save in composer' },
];

const ARTICLES: HelpArticle[] = [
    {
        id: 'before-you-start',
        title: 'Before you start',
        keywords: 'login account register draft reviewed tabs questions assessments',
        body: (
            <ul className="list-inside list-disc space-y-1">
                <li>Account creation and login is required. New users are prompted to register (email/password).</li>
                <li>After login you land on the Dashboard. Pick a course to open its question bank and assessments.</li>
                <li>Inside a course, switch between Questions and Assessments via the course tabs.</li>
                <li>
                    Draft vs Reviewed: newly added variants are drafts unless you mark them reviewed (uncheck
                    “Draft”). Drafts block exports to Canvas/TXT/Word.
                </li>
            </ul>
        ),
    },
    {
        id: 'course-selection-tour',
        title: 'Course selection and guided tour',
        keywords: 'course selection guided tour navigation first-run',
        body: (
            <ul className="list-inside list-disc space-y-1">
                <li>Use the Dashboard to enter the question bank and assessments for one course.</li>
                <li>The guided tour can be relaunched any time from this page (see “Relaunch guided tour” above).</li>
                <li>For new users, a first-run guided tour may start automatically.</li>
                <li>The tour highlights key actions (course select, tabs, help, and assessment workflow entry points).</li>
            </ul>
        ),
    },
    {
        id: 'onboarding',
        title: 'Onboarding: courses and topics',
        keywords: 'onboarding courses topics core sync logout',
        body: (
            <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                    Courses you teach in Core are added automatically when you sign in.
                </p>
                <ol className="list-inside list-decimal space-y-1">
                    <li>After login, your taught courses from Core appear on the dashboard.</li>
                    <li>Topics are kept in sync with Core automatically.</li>
                                        <li>(Optional) Use Logout in the profile menu to end the session.</li>
                </ol>
                <p className="text-sm">Tip: wait for courses to load before creating questions or assessments.</p>
            </div>
        ),
    },
    {
        id: 'create-questions',
        title: 'Create questions (manual & AI)',
        keywords: 'create questions manual ai mcq sa la metadata variant generate model',
        body: (
            <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Entry point: Questions tab → “Add Question”.</p>
                <div className="space-y-2">
                    <h4 className="font-semibold text-foreground">Manual</h4>
                    <ol className="list-inside list-decimal space-y-1">
                        <li>Select a course.</li>
                        <li>Click “Add Question”.</li>
                        <li>Fill question metadata: Primary Topic (required), Description, Type (MCQ / SA / LA).</li>
                        <li>
                            Fill variant details (every question needs at least one variant): Question Text (required),
                            Difficulty, optional Answer / Secondary Topics / Assessment link / Reference ID, and the
                            Draft toggle.
                        </li>
                        <li>Save. The new question appears in the Questions list.</li>
                    </ol>
                </div>
                <div className="space-y-2">
                    <h4 className="font-semibold text-foreground">With AI service</h4>
                    <ol className="list-inside list-decimal space-y-1">
                        <li>Click “Add Question”, then enter a prompt (topic/instructions) in the AI panel.</li>
                        <li>
                            Choose a model — Internal (campus-hosted, no API key) or External (provider-hosted,
                            requires your personal API key).
                        </li>
                        <li>If external, enter your provider API key (stored locally/encrypted; never sent to our servers).</li>
                        <li>Click Generate, review/edit the result, assign topics, set draft/reviewed, and save.</li>
                    </ol>
                </div>
            </div>
        ),
    },
    {
        id: 'variants',
        title: 'Create variants of a question',
        keywords: 'variants copy fields ai difficulty base variant',
        body: (
            <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    Question detail → “Create Variant”. Base variant is auto-picked from your entry point.
                </p>
                <ul className="list-inside list-disc space-y-1">
                    <li>
                        <span className="font-medium text-foreground">Manual:</span> enter Variant Text, Difficulty,
                        optional Answer/Secondary Topics/Assessment, then save.
                    </li>
                    <li>
                        <span className="font-medium text-foreground">Copy Fields:</span> click “Copy Fields” to prefill
                        text, difficulty, answer, and secondary topics from the base variant, then edit and save.
                    </li>
                    <li>
                        <span className="font-medium text-foreground">With AI service:</span> enter a prompt (e.g. “Make
                        it harder and add an edge case”), pick a model, generate, review/edit, and save.
                    </li>
                </ul>
            </div>
        ),
    },
    {
        id: 'upload',
        title: 'Upload PDF/Image → extract questions',
        keywords: 'upload pdf image ocr extract questions assessment fallback topic',
        body: (
            <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                    Entry point: Questions tab → “Upload Questions”. OCR + AI extract questions, then auto-create a new
                    assessment and an “Uploaded Questions” section.
                </p>
                <ol className="list-inside list-decimal space-y-1">
                    <li>From the Questions tab, select “Upload Questions”.</li>
                    <li>Fill assessment details (Type, Name) — required to save; the semester is derived from the course's term.</li>
                    <li>Pick an AI model (campus-hosted by default; external allowed with API key).</li>
                    <li>Upload PDF or image; progress shows OCR → extraction.</li>
                    <li>Review extracted drafts: edit fields, include/exclude per question, remove unwanted entries.</li>
                    <li>Click “Create Questions”; items become questions with draft variants under a new assessment.</li>
                </ol>
                <p className="text-sm">Note: exports are blocked until draft flags are cleared.</p>
            </div>
        ),
    },
    {
        id: 'assessments',
        title: 'Build assessments',
        keywords: 'assessments blueprint sections export canvas txt word import semester',
        body: (
            <div className="space-y-3">
                <p className="text-sm">
                    <span className="font-medium text-foreground">Create a blueprint:</span> Assessments tab → “Add
                    Assessment”. Provide Name, Type, Description, and seed Primary/Secondary/Excluded topics.
                </p>
                <p className="text-sm">
                    <span className="font-medium text-foreground">Edit a blueprint:</span> open an assessment → “Edit
                    Blueprint”, then update fields and topics.
                </p>
                <p className="text-sm">
                    <span className="font-medium text-foreground">Sections &amp; questions:</span> add a section, set
                    question types / topic filters / difficulty, run search, select variants, and save.
                </p>
                <p className="text-sm">
                    <span className="font-medium text-foreground">Export:</span> Canvas, Word (.docx), or TXT — all
                    require at least one question and no draft variants. Canvas export also requires instructor access
                    in the target course.
                </p>
                <p className="text-sm">
                    <span className="font-medium text-foreground">Import from Canvas:</span> connect Canvas, pick a
                    course and quiz, choose a local course + primary topic, set metadata, then import. Unsupported
                    question types are skipped.
                </p>
            </div>
        ),
    },
    {
        id: 'assessment-variant-workflow',
        title: 'Assessment variant workflow',
        keywords: 'assessment variant workflow baseline parallel exam similarity review',
        body: (
            <ol className="list-inside list-decimal space-y-1">
                <li>Select a course and baseline assessment.</li>
                <li>Mark the baseline as reference.</li>
                <li>Check variant readiness per baseline slot and generate missing variants with AI when needed.</li>
                <li>Assemble a variant exam with matched structure and different variants from the bank.</li>
                <li>Run AI review (baseline vs variant exam), then export review results (Word or JSON).</li>
            </ol>
        ),
    },
    {
        id: 'ai-models',
        title: 'AI models and API keys',
        keywords: 'ai models api keys internal external campus provider gemini openai deepseek anthropic',
        body: (
            <ul className="list-inside list-disc space-y-1">
                <li>Model picker subheaders: “Internal” and “External”.</li>
                <li>Internal: campus-hosted models (no provider API key needed; stays inside campus infrastructure).</li>
                <li>External: provider-hosted (Google/Gemini, OpenAI, DeepSeek, Anthropic). Prompts/data go to that provider.</li>
                <li>API keys (External only) are stored locally in your browser, encrypted; never sent to the backend.</li>
                <li>External selection shows a warning banner about data leaving campus systems.</li>
            </ul>
        ),
    },
    {
        id: 'bug-reporting',
        title: 'Report bugs and track status',
        keywords: 'bug report status admin diagnostics screenshot anonymous',
        body: (
            <ul className="list-inside list-disc space-y-1">
                <li>Use the bug icon in the top navigation to report an issue.</li>
                <li>Describe the issue and optionally submit anonymously.</li>
                <li>The app automatically captures recent console/network diagnostics and a screenshot to help triage.</li>
                <li>Admins can open “Bug reports” to review reports and update status (unhandled, in progress, resolved).</li>
            </ul>
        ),
    },
    {
        id: 'tips',
        title: 'Tips & common issues',
        keywords: 'tips common issues drafts primary topic canvas course code',
        body: (
            <ul className="list-inside list-disc space-y-1">
                <li>Primary topic is required for manual questions; add or sync topics from the course overview hero if missing.</li>
                <li>Drafts block exports; mark variants reviewed before exporting.</li>
                <li>Canvas import requires a local course and topic destination; unsupported Canvas question types are skipped.</li>
                <li>Course code helps AI relevance; generation still works without it but may be less accurate.</li>
                <li>Upload save requires at least one included question and filled assessment fields (type/name); the semester is set automatically from the course's term.</li>
            </ul>
        ),
    },
];

export const HelpPage = () => {
    const { startTour } = useGuidedTour();
    const [query, setQuery] = useState('');

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return ARTICLES;
        return ARTICLES.filter(
            (article) =>
                article.title.toLowerCase().includes(q) || article.keywords.includes(q),
        );
    }, [query]);

    return (
        <div className="flex flex-1 flex-col">
            <div className="@container/main flex flex-1 flex-col gap-2">
                <div className="flex flex-col gap-6 py-4 md:py-6">
                    <div className="px-4 lg:px-6">
                        <PageHeading
                            heading="Help Center"
                            subheading="Learn how to build questions, variants, and assessments in Question Maker."
                        />
                    </div>

                    <div className="grid gap-6 px-4 lg:px-6 lg:grid-cols-[1fr_320px]">
                        {/* ── User guide (searchable accordion) ─────────────────── */}
                        <Card>
                            <CardHeader>
                                <CardTitle>User guide</CardTitle>
                                <CardDescription>
                                    Browse the guide below, or search to jump to a topic.
                                </CardDescription>
                                <div className="relative pt-2">
                                    <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input
                                        value={query}
                                        onChange={(e) => setQuery(e.target.value)}
                                        placeholder="Search help topics…"
                                        className="pl-9"
                                        aria-label="Search help topics"
                                    />
                                </div>
                            </CardHeader>
                            <CardContent>
                                {filtered.length === 0 ? (
                                    <p className="py-6 text-center text-sm text-muted-foreground">
                                        No topics match “{query}”.
                                    </p>
                                ) : (
                                    <Accordion type="single" collapsible className="w-full">
                                        {filtered.map((article) => (
                                            <AccordionItem key={article.id} value={article.id}>
                                                <AccordionTrigger>{article.title}</AccordionTrigger>
                                                <AccordionContent className="text-muted-foreground">
                                                    {article.body}
                                                </AccordionContent>
                                            </AccordionItem>
                                        ))}
                                    </Accordion>
                                )}
                            </CardContent>
                        </Card>

                        {/* ── Sidebar: tour + shortcuts ─────────────────────────── */}
                        <div className="flex flex-col gap-6">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <IconRoute className="size-5" />
                                        Guided tour
                                    </CardTitle>
                                    <CardDescription>
                                        Re-run the walkthrough of key actions across the app.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <Button type="button" onClick={() => startTour('main')}>
                                        <IconRoute className="size-4" />
                                        Relaunch guided tour
                                    </Button>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <IconKeyboard className="size-5" />
                                        Keyboard shortcuts
                                    </CardTitle>
                                    <CardDescription>Speed up common actions.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <ul className="flex flex-col gap-2">
                                        {SHORTCUTS.map((shortcut) => (
                                            <li
                                                key={shortcut.keys}
                                                className="flex items-center justify-between gap-3"
                                            >
                                                <span className="text-sm text-muted-foreground">
                                                    {shortcut.label}
                                                </span>
                                                <Badge variant="outline" className="font-mono">
                                                    {shortcut.keys}
                                                </Badge>
                                            </li>
                                        ))}
                                    </ul>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
