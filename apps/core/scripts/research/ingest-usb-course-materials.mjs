/**
 * Upload curated USB READMEs/code excerpts into EduAI course materials for RAG.
 *
 * Usage (from apps/core):
 *   RESEARCH_PASSWORD='...' node ./scripts/research/ingest-usb-course-materials.mjs
 *
 * Options:
 *   --dry-run              List files only; no HTTP calls
 *   --course "COSC 121"    Upload one course from manifest (default: all)
 *   --publish              PATCH publish after uploads
 *   --enroll EMAIL         POST student enrollment for research user
 *   --manifest PATH        Override manifest JSON
 *   --usb-root PATH        Override USB root directory
 *
 * Env:
 *   RESEARCH_BASE_URL / CHAT_SMOKE_URL — default https://dev.eduai.ok.ubc.ca
 *   RESEARCH_EMAIL / CHAT_SMOKE_EMAIL
 *   RESEARCH_PASSWORD / CHAT_SMOKE_PASSWORD
 *   RESEARCH_USB_ROOT — override manifest usbRoot
 */
import { readFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Blob } from "node:buffer";
import { loginEduAI, fetchJson } from "./research-http-auth.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST = join(__dirname, "usb-course-materials.manifest.json");

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    publish: false,
    course: null,
    enrollEmail: null,
    manifest: DEFAULT_MANIFEST,
    usbRoot: null,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--publish") opts.publish = true;
    else if (arg === "--course") opts.course = argv[++i];
    else if (arg === "--enroll") opts.enrollEmail = argv[++i];
    else if (arg === "--manifest") opts.manifest = resolve(argv[++i]);
    else if (arg === "--usb-root") opts.usbRoot = resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return opts;
}

function mimeForPath(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  const map = {
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".java": "text/x-java-source",
    ".asm": "text/plain",
    ".c": "text/x-c",
    ".h": "text/plain",
  };
  return map[ext] || "text/plain";
}

function loadManifest(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const curatedRoot = resolve(
    process.env.RESEARCH_CURATED_ROOT || join(__dirname, raw.curatedRoot || "curated-materials"),
  );
  const usbRoot = raw.usbRoot
    ? resolve(process.env.RESEARCH_USB_ROOT || raw.usbRoot)
    : null;
  return { ...raw, usbRoot, curatedRoot };
}

function resolveMaterialPath(item, manifest) {
  if (item.curated) {
    return { abs: join(manifest.curatedRoot, item.curated), source: "curated" };
  }
  if (item.path) {
    if (!manifest.usbRoot) {
      throw new Error(`USB path requires usbRoot in manifest: ${item.path}`);
    }
    return { abs: join(manifest.usbRoot, item.path), source: "usb" };
  }
  throw new Error(`Material entry missing path or curated: ${JSON.stringify(item)}`);
}

async function listCourses(baseUrl, cookie) {
  const { res, json } = await fetchJson(`${baseUrl}/api/courses`, { cookie });
  if (!res.ok) {
    throw new Error(`GET /api/courses failed — HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  return json.courses ?? [];
}

async function resolveCourseId(baseUrl, cookie, courseCode, courses) {
  const match = courses.find((c) => c.code === courseCode);
  if (!match) {
    throw new Error(
      `Course not found: ${courseCode}. Create it in EduAI first, then re-run. Known codes: ${courses.map((c) => c.code).join(", ")}`,
    );
  }
  return match.id;
}

async function uploadMaterial(baseUrl, cookie, courseId, filePath, title) {
  const bytes = readFileSync(filePath);
  const fileName = basename(filePath);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeForPath(filePath) }), fileName);
  form.append("apiKeys", JSON.stringify({}));

  const { res, json, text } = await fetchJson(`${baseUrl}/api/courses/${courseId}/materials`, {
    cookie,
    method: "POST",
    body: form,
  });

  if (res.status === 409) {
    return { status: "duplicate", materialId: json?.materialId, title };
  }
  if (!res.ok) {
    throw new Error(`Upload failed for ${title} — HTTP ${res.status}: ${text}`);
  }

  return { status: "uploaded", materialId: json?.materialId, title };
}

async function publishCourse(baseUrl, cookie, courseId, courseCode) {
  const { res, text } = await fetchJson(`${baseUrl}/api/courses/${courseId}/publish`, {
    cookie,
    method: "PATCH",
  });
  if (!res.ok) {
    throw new Error(`Publish failed for ${courseCode} — HTTP ${res.status}: ${text}`);
  }
  return true;
}

async function enrollStudent(baseUrl, cookie, courseId, email) {
  const { res, json, text } = await fetchJson(`${baseUrl}/api/courses/${courseId}/enrollments`, {
    cookie,
    method: "POST",
    body: JSON.stringify({ email, role: "STUDENT" }),
  });
  if (!res.ok) {
    throw new Error(`Enroll failed for ${email} — HTTP ${res.status}: ${text || JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  const opts = parseArgs(process.argv);
  const manifest = loadManifest(opts.manifest);
  if (opts.usbRoot) manifest.usbRoot = opts.usbRoot;

  const courseBlocks = manifest.courses.filter((c) => !opts.course || c.courseCode === opts.course);
  if (!courseBlocks.length) {
    throw new Error(opts.course ? `No manifest entry for course ${opts.course}` : "Manifest has no courses");
  }

  if (opts.dryRun) {
    let total = 0;
    for (const block of courseBlocks) {
      console.log(`\n${block.courseCode}`);
      for (const item of block.materials) {
        const { abs, source } = resolveMaterialPath(item, manifest);
        total++;
        console.log(`  ${existsSync(abs) ? "OK" : "MISSING"} [${source}] ${item.title}\n      ${abs}`);
      }
    }
    console.log(`\n${total} files listed (see usb-course-materials.CURATION.md)`);
    return;
  }

  const { baseUrl, cookie } = await loginEduAI();
  const courses = await listCourses(baseUrl, cookie);

  for (const block of courseBlocks) {
    console.log(`\n=== ${block.courseCode} ===`);
    const courseId = await resolveCourseId(baseUrl, cookie, block.courseCode, courses);

    for (const item of block.materials) {
      const { abs } = resolveMaterialPath(item, manifest);
      if (!existsSync(abs)) {
        console.warn(`SKIP missing file: ${abs}`);
        continue;
      }
      const result = await uploadMaterial(baseUrl, cookie, courseId, abs, item.title || basename(abs));
      console.log(`${result.status.toUpperCase()}: ${result.title}${result.materialId ? ` (${result.materialId})` : ""}`);
    }

    if (opts.publish) {
      await publishCourse(baseUrl, cookie, courseId, block.courseCode);
      console.log(`PUBLISHED: ${block.courseCode}`);
    }

    if (opts.enrollEmail) {
      await enrollStudent(baseUrl, cookie, courseId, opts.enrollEmail);
      console.log(`ENROLLED: ${opts.enrollEmail} in ${block.courseCode}`);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
