import { useGuidedTour } from '../contexts/GuidedTourContext';

export const HelpPage = () => {
    const { startTour } = useGuidedTour();

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="mx-auto max-w-4xl px-6 py-10 space-y-10 text-base">
                <header className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Help Center</p>
                    <h1 className="text-3xl font-bold">Question Maker User Guide</h1>
                    <div className="flex flex-wrap gap-2 pt-2">
                        <button
                            type="button"
                            onClick={() => startTour('main')}
                            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-800 hover:border-gray-400"
                        >
                            Start Guided Tour
                        </button>
                    </div>
                </header>

                <section className="space-y-2">
                    <h2 className="text-xl font-semibold" id="toc">Table of Contents</h2>
                    <ol className="list-decimal list-inside space-y-1">
                        <li><a href="#before-you-start" className="text-primary hover:underline">Before You Start</a></li>
                        <li><a href="#course-selection-tour" className="text-primary hover:underline">Course Selection and Guided Tour</a></li>
                        <li><a href="#onboarding" className="text-primary hover:underline">Onboarding: Add Courses and Topics</a></li>
                        <li>
                            <a href="#create-questions" className="text-primary hover:underline">Create Questions</a>
                            <ul className="list-disc list-inside pl-4 text-xs space-y-1">
                                <li>Manual</li>
                                <li>AI service–assisted</li>
                            </ul>
                        </li>
                        <li>
                            <a href="#variants" className="text-primary hover:underline">Create Variants</a>
                            <ul className="list-disc list-inside pl-4 text-xs space-y-1">
                                <li>Manual</li>
                                <li>Copy Fields</li>
                                <li>AI service–assisted</li>
                            </ul>
                        </li>
                        <li><a href="#upload" className="text-primary hover:underline">Upload PDF/Image → Extract Questions</a></li>
                        <li>
                            <a href="#assessments" className="text-primary hover:underline">Build Assessments</a>
                            <ul className="list-disc list-inside pl-4 text-xs space-y-1">
                                <li>Create/Edit Blueprint</li>
                                <li>Create Sections &amp; Select Questions</li>
                                <li>Inline Question/Variant Creation</li>
                                <li>Export to Canvas</li>
                                <li>Import from Canvas</li>
                                <li>Export to TXT</li>
                                <li>Export to Word</li>
                            </ul>
                        </li>
                        <li><a href="#assessment-variant-workflow" className="text-primary hover:underline">Assessment Variant Workflow</a></li>
                        <li><a href="#ai-models" className="text-primary hover:underline">AI Models and API Keys</a></li>
                        <li><a href="#bug-reporting" className="text-primary hover:underline">Report Bugs and Track Status</a></li>
                        <li><a href="#tips" className="text-primary hover:underline">Tips &amp; Common Issues</a></li>
                    </ol>
                </section>

                <section id="before-you-start" className="space-y-2">
                    <h2 className="text-xl font-semibold">1. Before You Start</h2>
                    <ul className="list-disc list-inside space-y-1">
                        <li>Account creation and login is required. New users are prompted to register (email/password).</li>
                        <li>After login you land on the Course Selection page (`/courses`). Pick a course to open `/home`.</li>
                        <li>Inside `/home`, switch between Questions and Assessments via the top tabs.</li>
                        <li>Draft vs Reviewed: Newly added variants are drafts unless you mark them reviewed (uncheck “Draft”). Drafts block exports to Canvas/TXT/Word.</li>
                    </ul>
                </section>

                <section id="course-selection-tour" className="space-y-2">
                    <h2 className="text-xl font-semibold">2. Course Selection and Guided Tour</h2>
                    <ul className="list-disc list-inside space-y-1">
                        <li>Use Course Selection to enter the question bank and assessments for one course.</li>
                        <li>The “Guided tour” button is available in the top navigation on both Course Selection and Home pages.</li>
                        <li>For new users, a first-run guided tour may start automatically.</li>
                        <li>The tour highlights key actions (course select, tabs, help, and assessment workflow entry points).</li>
                    </ul>
                </section>

                <section id="onboarding" className="space-y-2">
                    <h2 className="text-xl font-semibold">3. Onboarding: Add Courses and Topics</h2>
                    <p className="text-sm text-muted-foreground">Flow: top nav profile icon (👤) on `/courses` or `/home` → “Link courses from AI service”.</p>
                    <ol className="list-decimal list-inside space-y-1">
                        <li>Open the profile button in the top-right of the Home page.</li>
                        <li>In “Link courses from AI service”, pick the courses you teach.
                            <ul className="list-disc list-inside pl-4 space-y-1">
                                <li>“Already added” badge means it’s already in your library.</li>
                                <li>Each course imports its topics automatically from the AI service.</li>
                            </ul>
                        </li>
                        <li>Click “Add selected courses”. Courses + topics are created locally.</li>
                        <li>(Optional) Use the “Logout” button in this dialog to end the session.</li>
                    </ol>
                    <p className="text-sm">Tip: Add courses before creating questions or assessments.</p>
                </section>

                <section id="create-questions" className="space-y-4">
                    <div className="space-y-2">
                        <h2 className="text-xl font-semibold">4. Create Questions</h2>
                        <p className="text-sm text-muted-foreground">Entry point: Questions tab → “Add Question”.</p>
                    </div>
                    <div className="space-y-2">
                        <h3 className="text-lg font-semibold">3.1 Manual</h3>
                        <ol className="list-decimal list-inside space-y-1">
                            <li>Select a course from the top selector.</li>
                            <li>Click “Add Question”.</li>
                            <li>Fill Question Metadata:
                                <ul className="list-disc list-inside pl-4 space-y-1">
                                    <li>Primary Topic (required)</li>
                                    <li>Description (short label for the question)</li>
                                    <li>Type: MCQ / SA / LA</li>
                                </ul>
                            </li>
                            <li>Fill Variant Details (every question needs at least one variant):
                                <ul className="list-disc list-inside pl-4 space-y-1">
                                    <li>Question Text (required)</li>
                                    <li>Difficulty (easy/medium/hard)</li>
                                    <li>Optional: Answer, Secondary Topics, link to an Assessment, Reference ID</li>
                                    <li>Draft toggle: leave on to keep as draft; turn off to mark reviewed.</li>
                                </ul>
                            </li>
                            <li>Save. The new question appears in the Questions list.</li>
                        </ol>
                    </div>
                    <div className="space-y-2">
                        <h3 className="text-lg font-semibold">3.2 With AI service</h3>
                        <ol className="list-decimal list-inside space-y-1">
                            <li>Click “Add Question”.</li>
                            <li>On right-hand panel enter a prompt (topic/instructions).</li>
                            <li>Choose a model:
                                <ul className="list-disc list-inside pl-4 space-y-1">
                                    <li>Internal: campus-hosted; no provider API key; data stays on campus servers.</li>
                                    <li>External: provider-hosted (e.g., Google/Gemini, OpenAI, DeepSeek, Anthropic); requires your personal API key.</li>
                                </ul>
                            </li>
                            <li>If external, enter your provider API key (stored locally/encrypted; never sent to our servers). A warning banner reminds you data leaves campus.</li>
                            <li>Click Generate. Review/edit the returned question text/description, assign topics, and set draft/reviewed status. Save as in 3.1.</li>
                        </ol>
                    </div>
                </section>

                <section id="variants" className="space-y-4">
                    <div className="space-y-2">
                        <h2 className="text-xl font-semibold">5. Create Variants of a Question</h2>
                        <p className="text-sm text-muted-foreground">Question detail → “Create Variant”. Base variant is auto-picked from your entry point.</p>
                    </div>
                    <div className="space-y-2">
                        <h3 className="text-lg font-semibold">4.1 Manual</h3>
                        <ol className="list-decimal list-inside space-y-1">
                            <li>Open the question, choose “Create Variant”</li>
                            <li>Enter Variant Text, Difficulty, optional Answer/Secondary Topics/Assessment.</li>
                            <li>Draft toggle: leave draft on by default; turn off when reviewed.</li>
                            <li>Save. The variant is added to the question; question list updates.</li>
                        </ol>
                        <div className="rounded-lg border bg-muted/30 p-3 max-w-2xl">
                            <img
                                src="/help/variant.png"
                                alt="Create Variant form"
                                className="w-full md:w-5/6 rounded-md border bg-white"
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <h3 className="text-lg font-semibold">4.2 Copy Fields (quick fill)</h3>
                        <ol className="list-decimal list-inside space-y-1">
                            <li>Open the question, choose “Create Variant”</li>
                            <li>From the right-hand panel, click “Copy Fields” to prefill text, difficulty, answer, and secondary topics from the base variant.</li>
                            <li>Edit any fields as needed (and adjust draft status).</li>
                            <li>Save.</li>
                        </ol>
                    </div>
                    <div className="space-y-2">
                        <h3 className="text-lg font-semibold">4.3 With AI service</h3>
                        <ol className="list-decimal list-inside space-y-1">
                            <li>Open the question, choose “Create Variant”</li>
                            <li>From the right-hand panel, enter an AI prompt (e.g., “Make it harder and add an edge case”).</li>
                            <li>Pick model (Internal vs External + API key, same rules as 3.2).</li>
                            <li>Generate, then review/edit the variant text and difficulty; adjust topics.</li>

                            <li>Save (draft or reviewed).</li>
                        </ol>
                    </div>
                </section>

                <section id="upload" className="space-y-2">
                    <h2 className="text-xl font-semibold">6. Upload PDF/Image → Extract Questions</h2>
                    <p className="text-sm text-muted-foreground">Entry point: Questions tab → “Upload Questions”. OCR + AI extract questions, then auto-create a new assessment and an “Uploaded Questions” section.</p>
                    <ol className="list-decimal list-inside space-y-1">
                        <li>From the Questions tab, select the “Upload Questions” button.</li>
                        <li>Fill Assessment details (Type, Name, Semester) — required to save.</li>
                        <li>Pick AI model (UBC Hosted by default; external allowed with API key).</li>
                        <li>Upload PDF or image. Progress shows OCR → extraction.</li>
                        <li>Review extracted drafts:
                            <ul className="list-disc list-inside pl-4 space-y-1">
                                <li>Edit Summary, Question Text, Topics, Difficulty, Type, optional Answer.</li>
                                <li>Include/Exclude toggle per question; remove unwanted entries.</li>
                                <li>If no topics exist, a fallback topic (“Uploaded Questions”) is auto-created.</li>
                            </ul>
                        </li>
                        <li>Click “Create Questions”. All included items become questions with draft variants, and a new assessment + section is created.</li>
                        <li>After save, you are navigated to the new assessment page.</li>
                    </ol>
                    <p className="text-sm">Notes: Exports are blocked until draft flags are cleared.</p>
                    <div className="rounded-lg border bg-muted/30 p-3 max-w-2xl">
                        <img
                            src="/help/upload-assessment.png"
                            alt="Upload questions dialog with assessment details and review list"
                            className="w-full md:w-5/6 rounded-md border bg-white"
                        />
                    </div>
                </section>

                <section id="assessments" className="space-y-4">
                    <div className="space-y-2">
                        <h2 className="text-xl font-semibold">7. Build Assessments</h2>
                    </div>
                    <div className="space-y-2">
                        <h3 className="text-lg font-semibold">7.1 Create an Assessment Blueprint</h3>
                        <ol className="list-decimal list-inside space-y-1">
                            <li>Assessments tab → “Add Assessment”.</li>
                            <li>Provide Name, Type (Assignment/Lab/Quiz/Midterm/Final), Semester, Description.</li>
                            <li>Select Primary/Secondary/Excluded topics (seed defaults for sections).</li>
                            <li>Save Blueprint. It appears in the Assessments list.</li>
                        </ol>
                        <div className="rounded-lg border bg-muted/30 p-3 max-w-2xl">
                            <img
                                src="/help/add-assessment-blueprint.png"
                                alt="Add Assessment blueprint modal"
                                className="w-full md:w-5/6 rounded-md border bg-white"
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <h3 className="text-lg font-semibold">7.2 Edit an Assessment Blueprint</h3>
                        <ol className="list-decimal list-inside space-y-1">
                            <li>Open an assessment page → click “Edit Blueprint”.</li>
                            <li>Review/update Name, Type, Semester, Description.</li>
                            <li>Adjust Primary/Secondary/Excluded topics as needed.</li>
                            <li>Save Blueprint; changes apply to that assessment’s defaults.</li>
                        </ol>
                        <div className="rounded-lg border bg-muted/30 p-3 max-w-2xl">
                            <img
                                src="/help/edit-assessment-blueprint.png"
                                alt="Edit Assessment blueprint modal"
                                className="w-full md:w-5/6 rounded-md border bg-white"
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <h3 className="text-lg font-semibold">7.3 Create Sections and Select Questions</h3>
                        <ol className="list-decimal list-inside space-y-1">
                            <li>On an assessment page: Click to add a section (Create Section panel).</li>
                            <li>Set desired question types, topic filters, difficulty and reasoning emphasis.</li>
                            <li>Run search; matching questions/variants are listed based on those filters.</li>
                            <li>Select variants to attach to the section.</li>
                            <li>Save the section; it appears in the assessment page.</li>
                        </ol>
                        <div className="rounded-lg border bg-muted/30 p-3 max-w-2xl">
                            <img
                                src="/help/create-section.png"
                                alt="Create Section panel with filters and search results"
                                className="w-full md:w-5/6 rounded-md border bg-white"
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <h3 className="text-lg font-semibold">7.4 Create Questions/Variants Inline During Section Building</h3>
                        <ul className="list-disc list-inside space-y-1">
                            <li>“Create Question” → opens the Add Question dialog (see Section 3).</li>
                            <li>“Create Variant” → opens the Add Variant dialog (see Section 4).</li>
                            <li>New items will appear in the search results and can be added to the section.</li>
                        </ul>
                        <div className="rounded-lg border bg-muted/30 p-3 max-w-2xl">
                            <img
                                src="/help/create-section.png"
                                alt="Inline create options while building a section"
                                className="w-full md:w-5/6 rounded-md border bg-white"
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <h3 className="text-lg font-semibold">7.5 Export to Canvas</h3>
                        <ol className="list-decimal list-inside space-y-1">
                            <li>Entry: Assessments page → “Export to Canvas”.</li>
                            <li>Requirements:
                                <ul className="list-disc list-inside pl-4 space-y-1">
                                    <li>All variants must be reviewed (no drafts) or the export is blocked.</li>
                                    <li>You must be an instructor in the target Canvas course.</li>
                                </ul>
                            </li>
                            <li>Flow in the dialog:
                                <ul className="list-disc list-inside pl-4 space-y-1">
                                    <li>If not connected: enter Canvas URL + Canvas API key, then connect (connection is stored for your user).</li>
                                    <li>Once connected, pick a Canvas course from the list (Change Connection lets you reconnect with different credentials).</li>
                                    <li>Click Export. A Canvas quiz is created with the assessment’s questions.</li>
                                    <li>Success message shows questions created and quiz link/ID.</li>
                                </ul>
                            </li>
                        </ol>
                        <div className="rounded-lg border bg-muted/30 p-3 max-w-2xl">
                            <img
                                src="/help/export-to-txt-canvas.png"
                                alt="Canvas export dialog with connection and course selection"
                                className="w-full md:w-5/6 rounded-md border bg-white"
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <h3 className="text-lg font-semibold">7.6 Export to TXT</h3>
                        <p className="text-sm">Entry: Assessment page → “Export to TXT”. Requirements: At least one question and no draft variants. Output: Downloads questions as a .txt file.</p>
                        <div className="rounded-lg border bg-muted/30 p-3 max-w-2xl">
                            <img
                                src="/help/export-to-txt-canvas.png"
                                alt="Export to TXT action"
                                className="w-full md:w-5/6 rounded-md border bg-white"
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <h3 className="text-lg font-semibold">7.7 Import from Canvas</h3>
                        <ol className="list-decimal list-inside space-y-1">
                            <li>Entry: Assessments tab → “Import from Canvas”.</li>
                            <li>If not connected, enter Canvas URL + API key and connect.</li>
                            <li>Select Canvas course and quiz.</li>
                            <li>Select local course + primary topic for imported questions.</li>
                            <li>Set assessment metadata (name, type, semester), then import.</li>
                            <li>Supported questions are imported into a new local assessment; unsupported question types are skipped.</li>
                        </ol>
                    </div>
                    <div className="space-y-2">
                        <h3 className="text-lg font-semibold">7.8 Export to Word (.docx)</h3>
                        <p className="text-sm">
                            Entry: Assessment page/list → “Export to Word”. Same checks as TXT export: requires questions and no draft variants.
                            Output downloads as a `.docx` file.
                        </p>
                    </div>
                </section>

                <section id="assessment-variant-workflow" className="space-y-2">
                    <h2 className="text-xl font-semibold">8. Assessment Variant Workflow</h2>
                    <p className="text-sm text-muted-foreground">Route: `/assessment-variant` (also available from assessment tooling).</p>
                    <ol className="list-decimal list-inside space-y-1">
                        <li>Select a course and baseline assessment.</li>
                        <li>Mark the baseline as reference.</li>
                        <li>Check variant readiness per baseline slot and generate missing variants with AI when needed.</li>
                        <li>Assemble a variant exam with matched structure and different variants from the bank.</li>
                        <li>Run AI review (baseline vs variant exam), then export review results (Word or JSON).</li>
                    </ol>
                </section>

                <section id="ai-models" className="space-y-2">
                    <h2 className="text-xl font-semibold">9. AI Models and API Keys</h2>
                    <ul className="list-disc list-inside space-y-1">
                        <li>Model picker subheaders: “Internal” and “External”.</li>
                        <li>Internal: Campus-hosted models (no provider API key needed; stays inside campus infrastructure).</li>
                        <li>External: Provider-hosted (e.g., Google/Gemini, OpenAI, DeepSeek, Anthropic). Prompts/data go to that provider.</li>
                        <li>API keys (External only) are stored locally in your browser, encrypted; never sent to the backend. Use “Change” to swap/remove a key.</li>
                        <li>Model pickers live in:
                            <ul className="list-disc list-inside pl-4 space-y-1">
                                <li>Add Question / Add Variant dialogs (AI service generation panel).</li>
                                <li>Upload Questions dialog (extraction model).</li>
                            </ul>
                        </li>
                        <li>External selection shows a warning banner about data leaving campus systems.</li>
                    </ul>
                    <div className="rounded-lg border bg-muted/30 p-3 max-w-2xl">
                      <img
                        src="/help/ai-models.png"
                        alt="Model picker showing Internal and External groups"
                        className="w-full md:w-1/2 rounded-md border bg-white"
                      />
                    </div>
                </section>

                <section id="bug-reporting" className="space-y-2">
                    <h2 className="text-xl font-semibold">10. Report Bugs and Track Status</h2>
                    <ul className="list-disc list-inside space-y-1">
                        <li>Use “Report bug” (floating button) or the bug icon in top navigation.</li>
                        <li>Describe the issue and optionally submit anonymously.</li>
                        <li>The app automatically captures recent console/network diagnostics and a screenshot to help triage.</li>
                        <li>Admin users can open “Bug reports” in the top navigation to review reports and update status (unhandled, in progress, resolved).</li>
                    </ul>
                </section>

                <section id="tips" className="space-y-2">
                    <h2 className="text-xl font-semibold">11. Tips &amp; Common Issues</h2>
                    <ul className="list-disc list-inside space-y-1">
                        <li>Primary topic required for manual questions; add topics via courses if missing.</li>
                        <li>Drafts block exports; mark variants reviewed before exporting.</li>
                        <li>Canvas import requires a local course and topic destination; unsupported Canvas question types are skipped.</li>
                        <li>AI service course code helps relevance; generation still works without it but may be less accurate.</li>
                        <li>Upload save requires at least one included question and filled assessment fields (type/name/semester).</li>
                    </ul>
                </section>
            </div>
        </div>
    );
};
