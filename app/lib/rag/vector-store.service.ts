import { OllamaEmbeddings } from "@langchain/ollama";
import { OpenAIEmbeddings } from "@langchain/openai";
import { TypeORMVectorStore } from "@langchain/community/vectorstores/typeorm";
import { In } from "typeorm";
import { Semaphore } from "await-semaphore";
import { DefaultEmbeddingModel, OllamaServerURL, VectorStores } from "./types";

export class VectorStoreService {
  private readonly connectionParams: any;
  private readonly embeddingModel: any;
  public readonly embeddingModelName: string;

  private questionStore?: any;
  private documentStore?: any;
  private documentAggregateStore?: any;
  private courseSettingStore?: any;

  private readonly initSemaphore: any = new Semaphore(1);

  constructor(options: any, skipInit = false) {
    this.connectionParams = options;

    if (String(DefaultEmbeddingModel()) !== "openai") {
      this.embeddingModel = new OllamaEmbeddings({
        model: DefaultEmbeddingModel(),
        baseUrl: OllamaServerURL(),
      });
    } else {
      this.embeddingModel = new OpenAIEmbeddings({
        modelName: "text-embedding-3-small",
      });
    }
    this.embeddingModelName = String(DefaultEmbeddingModel());

    if (!skipInit) void this.initializeVectorStores();
  }

  async initializeVectorStores() {
    const release = await this.initSemaphore.acquire();
    try {
      if (!this.questionStore) {
        this.questionStore = await TypeORMVectorStore.fromDataSource(
          this.embeddingModel,
          {
            postgresConnectionOptions: this.connectionParams,
            tableName: VectorStores.Question,
          }
        );
        await this.questionStore.ensureTableInDatabase();
      }

      if (!this.documentStore) {
        this.documentStore = await TypeORMVectorStore.fromDataSource(
          this.embeddingModel,
          {
            postgresConnectionOptions: this.connectionParams,
            tableName: VectorStores.Document,
          }
        );
        await this.documentStore.ensureTableInDatabase();
      }

      if (!this.documentAggregateStore) {
        this.documentAggregateStore = await TypeORMVectorStore.fromDataSource(
          this.embeddingModel,
          {
            postgresConnectionOptions: this.connectionParams,
            tableName: VectorStores.DocumentAggregate,
          }
        );
        await this.documentAggregateStore.ensureTableInDatabase();
      }

      if (!this.courseSettingStore) {
        this.courseSettingStore = await TypeORMVectorStore.fromDataSource(
          this.embeddingModel,
          {
            postgresConnectionOptions: this.connectionParams,
            tableName: VectorStores.CourseSettings,
          }
        );
        await this.courseSettingStore.ensureTableInDatabase();
      }
    } finally {
      release();
    }
  }

  async getDataSource(skipInit = false): Promise<any> {
    if (!skipInit) await this.initializeVectorStores();
    return (
      this.questionStore?.appDataSource ??
      this.documentStore?.appDataSource ??
      this.documentAggregateStore?.appDataSource ??
      this.courseSettingStore?.appDataSource
    );
  }

  async getStore(store: VectorStores): Promise<any> {
    await this.initializeVectorStores();
    switch (store) {
      case VectorStores.Question:
        return this.questionStore!;
      case VectorStores.Document:
        return this.documentStore!;
      case VectorStores.DocumentAggregate:
        return this.documentAggregateStore!;
      case VectorStores.CourseSettings:
        return this.courseSettingStore!;
    }
  }

  getEmbeddings(): any {
    return this.embeddingModel;
  }

  async getRepository(store: VectorStores): Promise<any> {
    const vectorStore = await this.getStore(store);
    return vectorStore.appDataSource.getRepository(vectorStore.documentEntity);
  }

  async embedQuery(text: string) {
    return await this.embeddingModel.embedQuery(text);
  }

  async embedDocuments(texts: string[]) {
    return await this.embeddingModel.embedDocuments(texts);
  }

  async similaritySearchWithScore(
    store: VectorStores,
    query: string,
    k?: number,
    filter?: Record<string, any>,
    _callbacks?: any
  ): Promise<[any, number][]> {
    const vectorStore = await this.getStore(store);
    // @ts-ignore - upstream typing
    return vectorStore.similaritySearchWithScore(query, k, filter, _callbacks);
  }

  async deleteVectorEntries(ids: string[], repository: any) {
    const entries = await repository.delete({ id: In(ids) });
    return { affected: entries.affected };
  }
}


