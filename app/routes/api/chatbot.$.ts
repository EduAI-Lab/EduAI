import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
const json = (data: any, init?: number | ResponseInit) =>
  new Response(JSON.stringify(data), {
    status: typeof init === "number" ? init : init?.status ?? 200,
    headers: { "Content-Type": "application/json", ...(typeof init === "object" ? init?.headers : {}) },
  });
import { VectorStoreService } from "~/lib/rag/vector-store.service";
import { ChatbotService } from "~/lib/rag/chatbot.service";
import { CourseSettingService } from "~/lib/rag/course-setting.service";
import { MultiModalLLMService } from "~/lib/rag/multimodal-llm.service";
import { UploadService } from "~/lib/rag/upload.service";
import { DocumentService } from "~/lib/rag/document/document.service";

const pgOptions = {
  type: "postgres",
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  username: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "postgres",
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined,
} as any;

const vector = new VectorStoreService(pgOptions);
const mllm = new MultiModalLLMService();
const upload = new UploadService(mllm);
const courseSettings = new CourseSettingService(vector);
const documents = new DocumentService(vector, upload);
const chatbot = new ChatbotService(vector, courseSettings, mllm);

export async function loader({ request, params }: LoaderFunctionArgs) {
  return json({ status: "ok" });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/^.*\/api\/chatbot\//, "");
  const method = request.method.toUpperCase();

  try {
    if (method === "POST" && pathname.match(/^question\/(\d+)$/)) {
      const courseId = Number(pathname.split("/")[1]);
      const body = await request.json();
      const { question, answer, verified, sourceDocuments, suggested } = body;
      if (!answer) return json({ error: "Invalid request data" }, 400);
      const res = await (await import("~/lib/rag/question/question.service"))
        .QuestionService.prototype.addQuestion.call(
          new (await import("~/lib/rag/question/question.service")).QuestionService(vector),
          courseId,
          question,
          answer,
          verified,
          sourceDocuments,
          suggested
        );
      return json(res);
    }

    if (method === "GET" && pathname.match(/^question\/(\d+)\/all$/)) {
      const courseId = Number(pathname.split("/")[1]);
      const service = new (await import("~/lib/rag/question/question.service")).QuestionService(vector);
      return json(await service.getAllQuestions(courseId));
    }

    if (method === "DELETE" && pathname.match(/^question\/(\d+)\/all$/)) {
      const courseId = Number(pathname.split("/")[1]);
      const service = new (await import("~/lib/rag/question/question.service")).QuestionService(vector);
      await service.deleteAllQuestions(courseId);
      return json({ status: "success" });
    }

    if (method === "POST" && pathname.match(/^document\/(\d+)\/url$/)) {
      const courseId = Number(pathname.split("/")[1]);
      const body = await request.json();
      let { url: fileUrl } = body;
      if (!fileUrl) return json({ error: "Invalid request data" }, 400);
      if (upload.checkIfGithubBlob(fileUrl)) fileUrl = upload.replaceBlobWithRaw(fileUrl);
      const saved = await documents.addDocumentFromURL(courseId, fileUrl);
      return json({ message: "File uploaded successfully", docId: saved.docId });
    }

    // multipart form-data upload: fields: file, source, metadata (JSON), parseAsPng ("true"|"false"), prefix
    if (method === "POST" && pathname.match(/^document\/(\d+)\/file$/)) {
      const courseId = Number(pathname.split("/")[1]);
      const form = await request.formData();
      const file = form.get("file") as File | null;
      const source = (form.get("source") as string) || undefined;
      const metadataRaw = (form.get("metadata") as string) || undefined;
      const parseAsPng = ((form.get("parseAsPng") as string) || "false") === "true";
      const prefix = (form.get("prefix") as string) || undefined;

      if (!file) return json({ error: "Invalid request: no file uploaded" }, 400);

      const ab = await file.arrayBuffer();
      const buffer = Buffer.from(ab);
      const meta = metadataRaw ? JSON.parse(metadataRaw) : { source };

      const saved = await documents.addDocumentFromBuffer(
        courseId,
        { originalname: file.name, buffer },
        meta,
        { parseAsPng, prefix }
      );
      return json({ message: "File uploaded successfully", docId: saved.docId });
    }

    if (method === "POST" && pathname.match(/^document\/(\d+)$/)) {
      const courseId = Number(pathname.split("/")[1]);
      const body = await request.json();
      const { documentText, metadata, prefix } = body;
      if (!documentText) return json({ error: "Invalid request data" }, 400);
      const res = await documents.addDocumentChunk(courseId, documentText, metadata, prefix);
      return json(res);
    }

    if (method === "GET" && pathname.match(/^document\/(\d+)$/)) {
      const courseId = Number(pathname.split("/")[1]);
      return json(await documents.getAllDocumentChunks(courseId));
    }

    if (method === "GET" && pathname.match(/^document\/aggregate\/(\d+)$/)) {
      const courseId = Number(pathname.split("/")[2]);
      return json(await documents.getAllDocumentAggregates(courseId));
    }

    // Create aggregate from raw text
    if (method === "POST" && pathname.match(/^document\/aggregate\/(\d+)$/)) {
      const courseId = Number(pathname.split("/")[2]);
      const body = await request.json();
      const { name, source, documentText, metadata, prefix } = body || {};
      if (!name || !source || !documentText) return json({ error: "Invalid request data" }, 400);
      const id = await documents.addDocumentFromRaw(courseId, name, source, documentText, metadata, prefix);
      return json({ id });
    }

    // Update aggregate
    if (method === "PATCH" && pathname.match(/^document\/aggregate\/(\d+)\/([^\/]+)$/)) {
      const courseId = Number(pathname.split("/")[2]);
      const docId = pathname.split("/")[3];
      const body = await request.json();
      const { documentText, metadata, prefix } = body || {};
      if (!documentText) return json({ error: "Invalid request data" }, 400);
      const res = await documents.updateDocumentAggregate(courseId, docId, documentText, metadata, prefix);
      return json(res);
    }

    // Delete aggregate
    if (method === "DELETE" && pathname.match(/^document\/aggregate\/([^\/]+)$/)) {
      const docId = pathname.split("/")[2];
      const res = await documents.deleteDocumentAggregate(docId);
      return json(res);
    }

    if (method === "POST" && pathname.match(/^chatbot\/(\d+)\/ask$/)) {
      const courseId = Number(pathname.split("/")[1]);
      const urlSkip = new URL(request.url).searchParams.get("skipSimilaritySearch");
      const skipSimilaritySearch = urlSkip === "true";
      const body = await request.json();
      const { question, history } = body;
      if (!question || !history) return json({ error: "Invalid request data" }, 400);
      const result = await chatbot.ask(courseId, question, history, skipSimilaritySearch);
      return json(result);
    }

    // Ask with images: multipart form-data: files: multiple 'file', fields: question, skipSimilaritySearch
    if (method === "POST" && pathname.match(/^chatbot\/(\d+)\/ask-with-images$/)) {
      const courseId = Number(pathname.split("/")[1]);
      const urlSkip = new URL(request.url).searchParams.get("skipSimilaritySearch");
      const skipSimilaritySearch = urlSkip === "true";
      const form = await request.formData();
      const question = (form.get("question") as string) || "";
      const historyRaw = (form.get("history") as string) || "[]";
      const files = form.getAll("file") as File[];
      if (!question) return json({ error: "Invalid request data" }, 400);
      let history: any[] = [];
      try { history = JSON.parse(historyRaw); } catch {}

      // Use multimodal LLM to summarize images and augment question
      const imageDescriptions: { imageId: number; description: string }[] = [];
      if (files && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          const ab = await f.arrayBuffer();
          const base64Image = Buffer.from(ab).toString("base64");
          const desc = await mllm.promptMLLM({
            imageBlobs: [base64Image],
            systemPrompt:
              `Please provide a concise description of what you see in this image, focusing on the key elements and any text content (if present). This description will be used for alt text for the image as well as fed to another LLM that will actually attempt to answer the question. Therefore, please provide a focus and describe any elements that would seem important to answer this question:\n${question}.`,
          });
          imageDescriptions.push({ imageId: i + 1, description: (desc as any).content?.toString?.() || "" });
        }
      }
      const enhancedQuestion = imageDescriptions.length
        ? `${question}\n\nSummaries of uploaded images:\n${imageDescriptions.map((x, idx) => `Image ${idx + 1}: ${x.description}`).join("\n")}`
        : question;
      const result = await chatbot.ask(courseId, enhancedQuestion, history, skipSimilaritySearch);
      return json({ ...result, imageDescriptions });
    }

    if (method === "POST" && pathname === "query") {
      const body = await request.json();
      const { query } = body;
      if (!query) return json({ error: "Missing query" }, 400);
      return json({ answer: await chatbot.query(query, "default") });
    }

    // Update document chunk
    if (method === "PATCH" && pathname.match(/^document\/(\d+)\/([^\/]+)$/)) {
      const courseId = Number(pathname.split("/")[1]);
      const docId = pathname.split("/")[2];
      const body = await request.json();
      const { documentText, metadata, prefix } = body || {};
      if (!documentText) return json({ error: "Invalid request data" }, 400);
      const res = await documents.updateDocumentChunk(courseId, docId, documentText, metadata, prefix);
      return json(res);
    }

    // Delete document chunk
    if (method === "DELETE" && pathname.match(/^document\/(\d+)\/([^\/]+)$/)) {
      const docId = pathname.split("/")[2];
      const res = await documents.deleteDocumentChunk(docId);
      return json(res);
    }

    // Reset course
    if (method === "PATCH" && pathname.match(/^document\/(\d+)\/reset$/)) {
      const courseId = Number(pathname.split("/")[1]);
      await documents.resetCourse(courseId);
      return json({ status: "success" });
    }

    // Clone course documents
    if (method === "POST" && pathname.match(/^document\/(\d+)\/clone\/(\d+)$/)) {
      const courseId = Number(pathname.split("/")[1]);
      const newCourseId = Number(pathname.split("/")[3]);
      const body = await request.json();
      const {
        includeDocuments,
        includeInsertedQuestions,
        includeInsertedLMSChatbotData,
        manuallyCreatedChunks,
        docIdMap,
      } = body || {};
      const newAggregateHelpmePDFIdMap = await documents.cloneCourseDocuments(
        courseId,
        newCourseId,
        includeDocuments,
        includeInsertedQuestions,
        includeInsertedLMSChatbotData,
        manuallyCreatedChunks,
        docIdMap
      );
      return json({ message: "Course documents cloned successfully", newAggregateHelpmePDFIdMap });
    }
  } catch (e: any) {
    return json({ error: e?.message || "Internal error" }, 500);
  }

  return json({ error: "Not found" }, 404);
}


