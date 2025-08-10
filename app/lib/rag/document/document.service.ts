type AnyDocument = { pageContent: string; metadata: any };
import { marked } from "marked";
import { VectorStoreService } from "../vector-store.service";
import { UploadService } from "../upload.service";
import { DefaultEmbeddingModel, EmbeddingModels, VectorStores } from "../types";

export class DocumentService {
  constructor(
    private vectorStoreService: VectorStoreService,
    private uploadService: UploadService
  ) {}

  async addAggregateChunks(documents: AnyDocument[]) {
    const repository = await this.vectorStoreService.getRepository(
      VectorStores.Document
    );
    const texts = documents.map((d: AnyDocument) => d.pageContent);
    const vectors = await this.vectorStoreService.embedDocuments(texts);
    const rows = vectors.map((embedding: number[], idx: number) => {
      const sanitizedContent = (documents[idx] as AnyDocument).pageContent.replace(/\0/g, "");
      const embeddingString = `[${embedding.join(",")}]`;
      return {
        pageContent: sanitizedContent,
        embedding: embeddingString,
        metadata: (documents[idx] as AnyDocument).metadata,
      } as any;
    });

    const chunkSize = 500;
    const ids: string[] = [];
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const savedChunk = await repository.save(chunk);
      const chunkIds = savedChunk.map((doc: any) => doc.id);
      ids.push(...chunkIds);
    }
    return ids;
  }

  async addDocumentFromURL(
    courseId: number,
    url: string,
    sourceOverride?: string
  ) {
    const urlParts = url.split("/");
    const file = urlParts[urlParts.length - 1];
    const response = await fetch(url, {
      method: "get",
      headers: { accept: "application/octet-stream" },
    });
    const buffer = await this.uploadService.bodyToBuffer(response.body);
    return await this.addDocumentFromBuffer(
      courseId,
      { originalname: file, buffer },
      { source: sourceOverride || url }
    );
  }

  async addDocumentFromBuffer(
    courseId: number,
    file: { originalname: string; buffer: Buffer },
    metaData: any = {},
    options: any = {}
  ) {
    const { type, name } = this.uploadService.getFileTypeAndName(
      file.originalname
    );
    const { parseAsPng, prefix } = options;

    const rawDocuments = await this.uploadService.loadFileForChunking(
      file,
      parseAsPng
    );
    const documentChunks = await this.splitDocuments(rawDocuments as any);
    if (documentChunks.length === 0) {
      throw new Error("No documents found");
    }

    const formattedDocumentChunks: AnyDocument[] = documentChunks.map((document: AnyDocument) => {
      const pageContent = prefix ? `${prefix}\n${document.pageContent}` : document.pageContent;
      return {
        pageContent,
        metadata: {
          ...metaData,
          loc: document.metadata?.loc,
          courseId: String(courseId),
          type,
          name,
        },
      };
    });

    const ids = await this.addAggregateChunks(formattedDocumentChunks);

    let aggregateName = file.originalname;
    if (prefix) {
      const courseTypeMatch = prefix.match(/^\(Course\s+(\w+)\)/);
      if (courseTypeMatch) {
        const courseType = courseTypeMatch[1];
        aggregateName = `Canvas ${courseType}: ${file.originalname}`;
      } else if (prefix.includes("Canvas") || prefix.includes("Course")) {
        const firstLine = prefix.split("\n")[0];
        aggregateName = `${firstLine}: ${file.originalname}`;
      }
    }

    const docId = await this.addDocumentAggregate(
      courseId,
      aggregateName,
      metaData.source,
      ids
    );

    return { docId, ids, type, name };
  }

  async addDocumentFromRaw(
    courseId: number,
    name: string,
    source: string,
    documentText: string,
    metadata: any,
    chunkPrefix?: string
  ) {
    const chunks = await this.addDocumentChunk(
      courseId,
      documentText,
      { type: "inserted_document", ...metadata, source, name },
      chunkPrefix
    );
    const ids = chunks.map((c: any) => c.id);
    return await this.addDocumentAggregate(courseId, name, source, ids, {
      fromLMS: metadata?.apiDocId != undefined,
    });
  }

  async addDocumentAggregate(
    courseId: number,
    fileName: string,
    source: string,
    ids: any[],
    metadata?: any
  ) {
    const repository = await this.vectorStoreService.getRepository(
      VectorStores.DocumentAggregate
    );
    const documentRow = {
      pageContent: fileName,
      metadata: {
        ...metadata,
        courseId: String(courseId),
        source: source,
        subDocumentIds: ids,
      },
    } as any;
    const savedDoc = await repository.save(documentRow);
    return savedDoc.id as string;
  }

  async getAllDocumentChunks(courseId: number) {
    const repository = await this.vectorStoreService.getRepository(
      VectorStores.Document
    );
    return await repository
      .createQueryBuilder("document")
      .select(["document.id", "document.pageContent", "document.metadata"])
      .where("document.metadata ->> 'courseId' = :courseId", {
        courseId: String(courseId),
      })
      .getMany();
  }

  async updateDocumentChunk(
    courseId: number,
    id: string,
    documentText: string,
    metadata?: any,
    prefix?: string
  ) {
    const repository = await this.vectorStoreService.getRepository(
      VectorStores.Document
    );
    const entry = await repository
      .createQueryBuilder("document")
      .where("document.id = :id", { id })
      .getOne();
    if (!entry) {
      throw new Error("Document chunk not found");
    }

    try {
      const questionVector = await this.vectorStoreService.embedQuery(
        `${prefix ? prefix + "\n" : ""}${documentText}`
      );
      entry.embedding = `[${questionVector.join(",")}]`;
      entry.pageContent = documentText;
      if (metadata) {
        entry.metadata = {
          ...entry.metadata,
          ...metadata,
          courseId: String(courseId),
        } as any;
      }
      return [await repository.save(entry)];
    } catch (e: any) {
      if (
        e.error?.toLowerCase().includes(
          "input length exceeds maximum context length"
        )
      ) {
        const entries = await this.addDocumentChunk(
          courseId,
          documentText,
          { ...(entry as any).metadata, ...metadata },
          prefix
        );
        await repository.query(
          `DELETE FROM ${VectorStores.Document} WHERE id::text = $1`,
          [id]
        );
        return entries as any[];
      } else {
        throw e;
      }
    }
  }

  async deleteDocumentChunk(id: string) {
    const repository = await this.vectorStoreService.getRepository(
      VectorStores.Document
    );
    const entry = await repository
      .createQueryBuilder("document")
      .where("document.id = :id", { id })
      .getOne();
    if (!entry) {
      throw new Error("Document chunk not found");
    }
    return await repository.remove(entry);
  }

  async getAllDocumentAggregates(courseId: number) {
    const repository = await this.vectorStoreService.getRepository(
      VectorStores.DocumentAggregate
    );
    return await repository
      .createQueryBuilder("document_aggregate")
      .select([
        "document_aggregate.id",
        "document_aggregate.pageContent",
        "document_aggregate.metadata",
      ])
      .where("document_aggregate.metadata ->> 'courseId' = :courseId", {
        courseId: String(courseId),
      })
      .getMany();
  }

  async updateDocumentAggregate(
    courseId: number,
    id: string,
    pageContent: string,
    metadata: any,
    prefix?: string
  ) {
    const repository = await this.vectorStoreService.getRepository(
      VectorStores.DocumentAggregate
    );

    const doc = await repository
      .createQueryBuilder("document_aggregate")
      .select(["document_aggregate.pageContent", "document_aggregate.metadata"])
      .where("document_aggregate.id = :id", { id })
      .getOne();

    if (!doc) {
      throw new Error(`Document with ID ${id} not found.`);
    }

    let ids = (doc as any).metadata.subDocumentIds;
    await this.vectorStoreService.deleteVectorEntries(
      ids,
      await this.vectorStoreService.getRepository(VectorStores.Document)
    );

    const cmd = {
      ...(doc as any).metadata,
      ...metadata,
      name: (doc as any).pageContent,
    } as any;
    delete (cmd as any).subDocumentIds;

    const chunks = await this.addDocumentChunk(
      courseId,
      pageContent,
      cmd,
      prefix
    );
    ids = chunks.map((c: any) => c.id);

    const md = {
      ...(doc as any).metadata,
      ...metadata,
      courseId: String(courseId),
      subDocumentIds: ids,
    };
    await repository.query(
      `UPDATE ${VectorStores.DocumentAggregate} SET metadata = $1 WHERE id::text = $2`,
      [JSON.stringify(md), id]
    );

    return { message: `Document updated, original vector entries deleted, new vector entries created for ID ${id}.` };
  }

  async deleteDocumentAggregate(id: string) {
    const repository = await this.vectorStoreService.getRepository(
      VectorStores.DocumentAggregate
    );
    const doc = await repository
      .createQueryBuilder("document_aggregate")
      .select(["document_aggregate.metadata"])
      .where("document_aggregate.id = :id", { id })
      .getOne();

    if (!doc) {
      throw new Error(`Document with ID ${id} not found.`);
    }

    const ids = (doc as any).metadata.subDocumentIds;
    await this.vectorStoreService.deleteVectorEntries(
      ids,
      await this.vectorStoreService.getRepository(VectorStores.Document)
    );

    await repository
      .createQueryBuilder()
      .delete()
      .from("document_aggregate")
      .where("id = :id", { id })
      .execute();

    return { message: `Document and associated vector entries successfully deleted for ID ${id}.` };
  }

  async resetCourse(courseId: number) {
    const dataSource = await this.vectorStoreService.getDataSource();
    if (!dataSource) throw new Error("Vector store not initialized");
    await dataSource.query(
      `DELETE FROM ${VectorStores.DocumentAggregate} WHERE metadata ->> 'courseId' = $1`,
      [String(courseId)]
    );
    await dataSource.query(
      `DELETE FROM ${VectorStores.Document} WHERE metadata ->> 'courseId' = $1`,
      [String(courseId)]
    );
    await dataSource.query(
      `DELETE FROM ${VectorStores.Question} WHERE metadata ->> 'courseId' = $1`,
      [String(courseId)]
    );
  }

  async cloneCourseDocuments(
    oldCourseId: number,
    newCourseId: number,
    includeDocuments: boolean,
    includeInsertedQuestions: boolean,
    includeInsertedLMSChatbotData: boolean,
    manuallyCreatedChunks: boolean,
    docIdMap?: Record<string, string>
  ): Promise<Record<string, string>> {
    const newAggregateHelpmePDFIdMap: Record<string, string> = {};

    const aggregateTypes = ["pdf", "pptx", "csv", "txt", "docx"];
    const excludedTypes: string[] = [];
    if (!includeInsertedQuestions) excludedTypes.push("inserted_question");
    if (!includeInsertedLMSChatbotData) excludedTypes.push("inserted_lms_document");
    if (!includeDocuments) excludedTypes.push(...aggregateTypes);
    if (!manuallyCreatedChunks) excludedTypes.push("inserted_document");

    await (
      await this.vectorStoreService.getDataSource()
    )!.transaction(async (manager: any) => {
      if (includeDocuments) {
        const aggregatesToClone = await manager.query(
          `SELECT id, "pageContent", metadata FROM document_aggregate WHERE metadata ->> 'courseId' = $1`,
          [String(oldCourseId)]
        );

        if (aggregatesToClone.length > 0 && !docIdMap) {
          console.error(
            `There are ${aggregatesToClone.length} aggregates to clone but no docIdMap was provided!`
          );
        }

        for (const aggregate of aggregatesToClone) {
          const subDocumentIds = aggregate.metadata.subDocumentIds || [];
          const newSubDocumentIds: string[] = [];
          const newIdHelpMeDB = docIdMap?.[aggregate.id];

          for (const subDocId of subDocumentIds) {
            const subDocument = (
              await manager.query(`SELECT * FROM ${VectorStores.Document} WHERE id = $1`, [subDocId])
            )[0];

            if (!subDocument || (subDocument.metadata.type && excludedTypes.includes(subDocument.metadata.type))) {
              continue;
            }

            const newMetadata = {
              ...subDocument.metadata,
              courseId: String(newCourseId),
              embeddingModel: this.vectorStoreService.embeddingModelName,
            };
            if (
              subDocument.metadata.source &&
              subDocument.metadata.source.startsWith('/api/v1/chatbot/document/')
            ) {
              if (newIdHelpMeDB) {
                newMetadata.source = `/api/v1/chatbot/document/${newCourseId}/${newIdHelpMeDB}`;
              } else {
                console.error(`No new idHelpMeDB for sub document ${subDocument.id}`);
              }
            }

            const saveRes = await manager.query(
              `INSERT INTO ${VectorStores.Document} ("pageContent",embedding,metadata) VALUES ($1,$2,$3) RETURNING id`,
              [subDocument.pageContent, subDocument.embedding, JSON.stringify(newMetadata)]
            );
            newSubDocumentIds.push(saveRes[0].id);
          }

          if (newSubDocumentIds.length > 0) {
            const newAggregateMetadata = {
              ...aggregate.metadata,
              courseId: String(newCourseId),
              subDocumentIds: newSubDocumentIds,
            };
            if (
              aggregate.metadata.source &&
              aggregate.metadata.source.startsWith('/api/v1/chatbot/document/')
            ) {
              if (newIdHelpMeDB) {
                newAggregateMetadata.source = `/api/v1/chatbot/document/${newCourseId}/${newIdHelpMeDB}`;
              } else {
                console.error(`No new idHelpMeDB for aggregate ${aggregate.id}`);
              }
            }
            const insertResult = await manager.query(
              `INSERT INTO document_aggregate ("pageContent", embedding, metadata) VALUES ($1, $2, $3) RETURNING id`,
              [aggregate.pageContent, aggregate.embedding, JSON.stringify(newAggregateMetadata)]
            );
            const savedAggregateId = insertResult[0].id;
            if (newIdHelpMeDB) {
              newAggregateHelpmePDFIdMap[newIdHelpMeDB] = savedAggregateId;
            }
          }
        }
      }

      if (includeDocuments) excludedTypes.push(...aggregateTypes);
      const documentsToClone = await manager.query(
        `SELECT * FROM ${VectorStores.Document} WHERE metadata ->> 'courseId' = $1 AND metadata ->> 'type' NOT IN (${excludedTypes
          .map((t) => `\'${t}\'`)
          .join(", ")})`,
        [String(oldCourseId)]
      );
      for (const doc of documentsToClone as any[]) {
        const newMetadata = { ...doc.metadata, courseId: String(newCourseId) };
        await manager.query(
          `INSERT INTO ${VectorStores.Document} ("pageContent",embedding,metadata) VALUES ($1,$2,$3) RETURNING id`,
          [doc.pageContent, doc.embedding, JSON.stringify(newMetadata)]
        );
      }
    });
    return newAggregateHelpmePDFIdMap;
  }
  async addDocumentChunk(
    courseId: number,
    documentText: string,
    metadata: any,
    prefix?: string
  ) {
    const repository = await this.vectorStoreService.getRepository(
      VectorStores.Document
    );
    const splitter = await DocumentService.getTextSplitter(prefix?.length);
    const splitTexts: string[] = await splitter.splitText(documentText as string);
    const texts = splitTexts.map((text) => `${prefix ? `${prefix}\n` : ""}${text}`);
    const queryEmbeddings = await this.vectorStoreService.embedDocuments(texts);
    const entries: any[] = [];
    for (let i = 0; i < queryEmbeddings.length; i++) {
      const queryEmbedding = queryEmbeddings[i];
      const text = texts[i];
      const embeddingString = `[${queryEmbedding.join(",")}]`;
      const entry = repository.create({
        pageContent: text,
        embedding: embeddingString,
        metadata: {
          ...metadata,
          courseId: String(courseId),
          embeddingModel: this.vectorStoreService.embeddingModelName,
        },
      } as any);
      const savedEntry = await repository.save(entry);
      const { embedding, ...entryWithoutEmbedding } = savedEntry as any;
      entries.push(entryWithoutEmbedding);
    }
    return entries;
  }

  async splitDocuments(documents: AnyDocument[]): Promise<AnyDocument[]> {
    return await (await DocumentService.getTextSplitter()).splitDocuments(documents as any);
  }

  static async getTextSplitter(sub = 0, sample?: string) {
    if (sample && (await this.textContainsMarkdown(sample))) {
      const chunkSize =
        Math.min(512, Math.round(EmbeddingModels[String(DefaultEmbeddingModel())].contextSize * 0.75)) -
        20 -
        sub;
      const { MarkdownTextSplitter } = await import("langchain/text_splitter");
      return new MarkdownTextSplitter({ chunkSize, chunkOverlap: 20 });
    }
    const chunkSize =
      Math.min(512, Math.round(EmbeddingModels[String(DefaultEmbeddingModel())].contextSize * 0.75)) -
      20 -
      sub;
    const { RecursiveCharacterTextSplitter } = await import("langchain/text_splitter");
    return new RecursiveCharacterTextSplitter({ chunkSize, chunkOverlap: 20 });
  }

  static async textContainsMarkdown(sample: string) {
    const tokenTypes: string[] = [];
    await marked(sample, {
      walkTokens: (token: any) => {
        tokenTypes.push((token as any).type);
      },
    } as any);
    const markdownTokens = [
      "space",
      "code",
      "fences",
      "heading",
      "hr",
      "link",
      "blockquote",
      "list",
      "html",
      "def",
      "table",
      "lheading",
      "escape",
      "tag",
      "reflink",
      "strong",
      "codespan",
      "url",
    ];
    return markdownTokens.some((tokenType) => tokenTypes.includes(tokenType));
  }
}


